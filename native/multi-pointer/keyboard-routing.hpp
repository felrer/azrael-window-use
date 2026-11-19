#pragma once
#include "platform.hpp"

namespace mp {
// UI-thread owned. The low-level hook only appends fixed-size records and marks
// an abort; identity, focus and SendInput work run outside the hook callback.
struct KeyboardBuffer {
    struct Event { DWORD vk=0, scan=0, flags=0; };
    static constexpr size_t capacity=4096, highWater=3072;
    std::array<Event,capacity> events{};
    size_t count=0, delivered=0;
    bool overflow=false;
    bool append(Event event) noexcept {
        if (count==capacity) { overflow=true; return false; }
        events[count++]=event; return true;
    }
    void reset() noexcept { count=delivered=0; overflow=false; }
};

class KeyboardReservation {
    std::atomic<bool>& reserved;
    ULONG_PTR& tag;
    Target origin;
    HWND focus=nullptr;
    DWORD focusThread=0;
    std::array<bool,256> initial{}, neutralized{}, modelHeld{};
    bool rootDestroyed=false, focusDestroyed=false, finishing=false;
    bool restored=false, abortRequested=false, abortNotified=false, deliveryUncertain=false;
    uint64_t deadline=0;
    size_t replayed=0;
    const char* failure="";

    static bool keyboardKey(unsigned vk) noexcept {
        return vk>VK_XBUTTON2 && vk!=VK_SHIFT && vk!=VK_CONTROL && vk!=VK_MENU;
    }
    INPUT input(const KeyboardBuffer::Event& event) const noexcept {
        INPUT out{}; out.type=INPUT_KEYBOARD;
        out.ki.wVk=static_cast<WORD>(event.vk);
        out.ki.wScan=static_cast<WORD>(event.scan);
        out.ki.dwFlags=(event.flags&LLKHF_UP?KEYEVENTF_KEYUP:0) |
            (event.flags&LLKHF_EXTENDED?KEYEVENTF_EXTENDEDKEY:0);
        if (event.scan) { out.ki.wVk=0; out.ki.dwFlags|=KEYEVENTF_SCANCODE; }
        out.ki.dwExtraInfo=tag; return out;
    }
    KeyboardBuffer::Event key(unsigned vk,bool up) const noexcept {
        const UINT scan=MapVirtualKeyExW(vk,MAPVK_VK_TO_VSC_EX,GetKeyboardLayout(origin.thread));
        return {vk,scan&0xff,static_cast<DWORD>((up?LLKHF_UP:0)|((scan&0xff00)?LLKHF_EXTENDED:0))};
    }
    void validateOrigin() {
        require(!rootDestroyed && !focusDestroyed,"keyboard_restore","Original keyboard window was destroyed");
        origin.validate();
        DWORD pid=0; const DWORD thread=GetWindowThreadProcessId(focus,&pid);
        require(IsWindow(focus) && thread==focusThread && pid==origin.pid &&
            GetAncestor(focus,GA_ROOT)==origin.hwnd,"keyboard_restore","Original focused window identity changed");
    }
    bool hasDestinationFocus() const {
        GUITHREADINFO info{sizeof(info)};
        return GetForegroundWindow()==origin.hwnd && GetGUIThreadInfo(origin.thread,&info) && info.hwndFocus==focus;
    }
    void requireDestination() {
        validateOrigin();
        require(hasDestinationFocus(),
            "keyboard_restore","Original keyboard focus is not restored; buffered input remains pending");
    }
    void restoreFocus() {
        validateOrigin();
        if (hasDestinationFocus()) { restored=true; return; }
        const DWORD self=GetCurrentThreadId();
        const bool attach=self!=origin.thread;
        require(!attach || AttachThreadInput(self,origin.thread,TRUE),"keyboard_restore","Cannot attach original input thread");
        // Always detach, including when foreground activation is denied.
        const bool foreground=GetForegroundWindow()==origin.hwnd || SetForegroundWindow(origin.hwnd)!=FALSE;
        if (foreground) SetFocus(focus);
        if (attach) AttachThreadInput(self,origin.thread,FALSE);
        requireDestination(); restored=true;
    }
    void send(const KeyboardBuffer::Event& event,bool destination) {
        if (destination) requireDestination();
        INPUT out=input(event);
        // A failed/partial injection has no automatic retry. Windows supplies
        // insertion counts, not a receipt from the destination application.
        if (SendInput(1,&out,sizeof(out))!=1) {
            deliveryUncertain=true;
            throw Failure("keyboard_delivery","Keyboard delivery failed; automatic replay is disabled",status());
        }
    }
public:
    KeyboardBuffer buffer;
    KeyboardReservation(std::atomic<bool>& active,ULONG_PTR& ownTag):reserved(active),tag(ownTag) {}
    bool active() const noexcept { return reserved.load(); }
    bool intercept(const KBDLLHOOKSTRUCT& event) noexcept {
        if (!active() || (event.flags&LLKHF_INJECTED)) return false;
        buffer.append({event.vkCode,event.scanCode,event.flags});
        if (buffer.count>=KeyboardBuffer::highWater) requestAbort("buffer_high_water");
        if (buffer.overflow) failure="buffer_overflow";
        return true;
    }
    void observeOwn(const KBDLLHOOKSTRUCT& event) noexcept {
        if (active() && !finishing && event.vkCode<256)
            modelHeld[event.vkCode]=(event.flags&LLKHF_UP)==0;
    }
    void destroyed(HWND window) noexcept {
        if (!active()) return;
        if (window==origin.hwnd) rootDestroyed=true;
        if (window==focus) focusDestroyed=true;
        if (rootDestroyed || focusDestroyed) requestAbort("original_window_destroyed");
    }
    bool requestAbort(const char* reason) noexcept {
        if (!active() || abortRequested) return false;
        abortRequested=true; failure=reason; return true;
    }
    bool expired(uint64_t now) const noexcept { return active() && now>=deadline; }
    bool takeAbortNotification() noexcept {
        if (!abortRequested || abortNotified) return false;
        abortNotified=true; return true;
    }
    json status() const {
        return {{"active",active()},{"bufferedEvents",buffer.count},{"replayedEvents",replayed},
            {"restored",restored},{"pending",active() || deliveryUncertain || buffer.overflow || buffer.delivered<buffer.count},
            {"failure",*failure?json(failure):json(nullptr)},{"abortRequested",abortRequested}};
    }
    void begin(unsigned maxMs) {
        require(!active(),"keyboard_reservation","A keyboard reservation is already active");
        require(!deliveryUncertain && !buffer.overflow && buffer.delivered==buffer.count,"keyboard_reservation","Undelivered keyboard input prevents a new reservation");
        // Public batches remain capped at 1000ms. Mouse drags can run for 2000ms
        // and additionally need their bounded foreground-preparation allowance.
        require(maxMs>0 && maxMs<=3000,"invalid_params","Keyboard reservation must be between 1 and 3000 ms");
        checkDesktop();
        origin.hwnd=GetForegroundWindow();
        require(origin.hwnd && GetAncestor(origin.hwnd,GA_ROOT)==origin.hwnd,"keyboard_reservation","Cannot pin original foreground root");
        origin.thread=GetWindowThreadProcessId(origin.hwnd,&origin.pid);
        origin.process=Handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,origin.pid));
        require(origin.process.value!=nullptr,"keyboard_reservation","Cannot pin original keyboard process");
        origin.born=creation(origin.process.value); origin.path=normalizedPath(executable(origin.process.value));
        origin.destroyed->store(false); rootDestroyed=focusDestroyed=false;
        GUITHREADINFO info{sizeof(info)};
        require(GetGUIThreadInfo(origin.thread,&info) && info.hwndFocus,"keyboard_reservation","Cannot pin original keyboard focus");
        focus=info.hwndFocus; focusThread=GetWindowThreadProcessId(focus,nullptr);
        validateOrigin(); requireDestination();
        buffer.reset(); initial.fill(false); neutralized.fill(false); modelHeld.fill(false);
        restored=false; abortRequested=abortNotified=false; failure=""; replayed=0;
        // Sample before injecting releases: GetAsyncKeyState is shared logical
        // state, so querying after neutralization would lose initially held keys.
        for (unsigned vk=1;vk<256;++vk) if (keyboardKey(vk)) initial[vk]=(GetAsyncKeyState(vk)&0x8000)!=0;
        deadline=GetTickCount64()+maxMs; reserved.store(true); finishing=true;
        try {
            for (unsigned vk=1;vk<256;++vk) if (initial[vk]) { send(key(vk,true),true); neutralized[vk]=true; }
            finishing=false;
        } catch (...) { finishing=false; requestAbort("neutralization_failed"); throw; }
    }
    void end() {
        if (!active()) {
            require(!deliveryUncertain && !*failure,"keyboard_delivery","Previous keyboard reservation failed");
            return;
        }
        require(!deliveryUncertain,"keyboard_delivery","Uncertain keyboard delivery requires explicit recovery; replay is disabled");
        finishing=true;
        try {
            // Covers a watchdog/disconnect handoff after broker releases its
            // owned keys. Releasing an already-up model key is harmless.
            for (unsigned vk=1;vk<256;++vk) if (modelHeld[vk]) { send(key(vk,true),false); modelHeld[vk]=false; }
            restoreFocus();
            for (unsigned vk=1;vk<256;++vk) if (neutralized[vk]) { send(key(vk,false),true); neutralized[vk]=false; }
            while (buffer.delivered<buffer.count) {
                send(buffer.events[buffer.delivered],true);
                SecureZeroMemory(&buffer.events[buffer.delivered],sizeof(KeyboardBuffer::Event));
                ++buffer.delivered; ++replayed;
            }
            // No dispatching Win32 call between observing an empty buffer and
            // clearing the gate: such a call can reenter the physical hook and
            // append an event after the drain has already finished.
            reserved.store(false); finishing=false;
        } catch (...) { finishing=false; if (!*failure) failure="restore_or_delivery_failed"; throw; }
        if (*failure) throw Failure("keyboard_reservation_aborted","Keyboard reservation aborted",status());
    }
};
} // namespace mp
