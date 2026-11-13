#pragma once
#include "overlay.hpp"
namespace mp {
// Retained because later hook-interruption simplifications can accidentally
// reinstate keyboard epoch cancellation inside an explicit reservation.
inline int keyboardReservationSelftest() {
    Signals signals;
    signals.tag=123;
    KeyboardReservation reservation(signals.keyboardReserved,signals.tag);
    KBDLLHOOKSTRUCT event{}; event.vkCode='A'; event.scanCode=30;
    require(!reservation.intercept(event),"selftest","Inactive reservation must not suppress input");
    signals.keyboardReserved.store(true);
    signals.modelKeyboardActive.store(true);
    const auto epoch=signals.epoch.load();
    require(!signals.observeForeignKeyboard(WM_KEYDOWN,event) && signals.physical['A'].load(),
        "selftest","Reserved physical key must be tracked without interruption");
    require(signals.epoch.load()==epoch,"selftest","Reserved keyboard must not advance mouse interruption epoch");
    require(reservation.intercept(event),"selftest","Reserved physical key must be suppressed");
    event.flags=LLKHF_UP;
    require(reservation.intercept(event),"selftest","Physical release must be buffered");
    require(reservation.buffer.count==2 && reservation.buffer.events[0].flags==0 &&
        reservation.buffer.events[1].flags==LLKHF_UP,"selftest","Buffered key edges must preserve order and held-state transition");
    event.flags=LLKHF_INJECTED;
    require(!reservation.intercept(event) && signals.observeForeignKeyboard(WM_KEYUP,event),
        "selftest","Foreign injection must pass through and retain interruption");
    require(reservation.buffer.count==2,"selftest","Foreign injection must never enter physical replay buffer");
    event.flags=0;
    for (size_t n=2;n<KeyboardBuffer::highWater;++n) reservation.intercept(event);
    require(reservation.takeAbortNotification() && !reservation.takeAbortNotification(),
        "selftest","High-water must request exactly one immediate abort notification");
    require(reservation.status().at("failure")=="buffer_high_water","selftest","Abort failure must remain visible");
    for (size_t n=KeyboardBuffer::highWater;n<KeyboardBuffer::capacity;++n) reservation.intercept(event);
    require(reservation.intercept(event) && reservation.buffer.count==KeyboardBuffer::capacity && reservation.buffer.overflow,
        "selftest","Overflow must stay suppressed and never overrun fixed storage");
    require(reservation.status().at("failure")=="buffer_overflow" && reservation.status().at("pending")==true,
        "selftest","Overflow cannot report successful delivery");
    reservation.buffer.reset();
    require(reservation.buffer.count==0 && reservation.buffer.delivered==0 && !reservation.buffer.overflow,
        "selftest","New buffer resets progress and overflow");
    return 0;
}

// Retained to catch future focus-reconstruction edits that pass queue-only
// checks. This uses real SendInput and real EDIT controls, but feeds the buffer
// directly; it does not claim to test physical low-level-hook arrival.
inline int keyboardReservationLiveSelftest() {
    checkDesktop();
    for (unsigned vk=1;vk<256;++vk)
        require(!(GetAsyncKeyState(vk)&0x8000),"selftest","Release all physical keys/buttons before live keyboard fixture");
    struct Fixture {
        HWND saved=GetForegroundWindow(), savedFocus=nullptr, first=nullptr, second=nullptr;
        DWORD savedPid=0, savedThread=0;
        Handle savedProcess;
        uint64_t savedBorn=0;
        bool shiftOwned=false;
        bool classRegistered=false;
        ULONG_PTR tag=0x314159;
        Fixture() {
            savedThread=GetWindowThreadProcessId(saved,&savedPid);
            savedProcess=Handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,savedPid));
            require(saved && savedProcess.value,"selftest","Cannot pin pre-test foreground");
            savedBorn=creation(savedProcess.value);
            GUITHREADINFO info{sizeof(info)};
            require(GetGUIThreadInfo(savedThread,&info)!=FALSE,"selftest","Cannot capture pre-test focus");
            savedFocus=info.hwndFocus;
            WNDCLASSW wc{}; wc.hInstance=GetModuleHandleW(nullptr);
            wc.lpfnWndProc=DefWindowProcW; wc.lpszClassName=L"AzraelKeyboardReservationFixture";
            require(RegisterClassW(&wc)!=0,"selftest","Cannot register keyboard fixture top-level class");
            classRegistered=true;
        }
        void shift(bool down) {
            INPUT input{}; input.type=INPUT_KEYBOARD; input.ki.wVk=VK_LSHIFT;
            input.ki.dwFlags=down?0:KEYEVENTF_KEYUP; input.ki.dwExtraInfo=tag;
            require(SendInput(1,&input,sizeof(input))==1,"selftest","Cannot inject fixture Shift edge");
            shiftOwned=down;
        }
        bool restore() noexcept {
            try {
                DWORD pid=0; const DWORD thread=GetWindowThreadProcessId(saved,&pid);
                if (IsWindow(saved) && pid==savedPid && thread==savedThread &&
                    WaitForSingleObject(savedProcess.value,0)==WAIT_TIMEOUT && creation(savedProcess.value)==savedBorn) {
                    const DWORD self=GetCurrentThreadId();
                    const bool attached=self==thread || AttachThreadInput(self,thread,TRUE)!=FALSE;
                    const bool foreground=GetForegroundWindow()==saved || SetForegroundWindow(saved)!=FALSE;
                    if (attached && foreground && IsWindow(savedFocus) && GetAncestor(savedFocus,GA_ROOT)==saved) SetFocus(savedFocus);
                    if (attached && self!=thread) AttachThreadInput(self,thread,FALSE);
                    GUITHREADINFO info{sizeof(info)};
                    return GetForegroundWindow()==saved && GetGUIThreadInfo(thread,&info) && info.hwndFocus==savedFocus;
                }
            } catch (...) {}
            return false;
        }
        ~Fixture() {
            // Release fixture-owned state before returning the user foreground.
            if (shiftOwned) {
                HWND own=IsWindow(first)?first:second;
                if (IsWindow(own)) SetForegroundWindow(own);
                INPUT input{}; input.type=INPUT_KEYBOARD; input.ki.wVk=VK_LSHIFT;
                input.ki.dwFlags=KEYEVENTF_KEYUP; input.ki.dwExtraInfo=tag;
                SendInput(1,&input,sizeof(input));
            }
            if (first && IsWindow(first)) DestroyWindow(first);
            if (second && IsWindow(second)) DestroyWindow(second);
            if (classRegistered) UnregisterClassW(L"AzraelKeyboardReservationFixture",GetModuleHandleW(nullptr));
            restore();
        }
    } fixture;
    auto pump=[] {
        const auto until=GetTickCount64()+100;
        do {
            MSG message{};
            while (PeekMessageW(&message,nullptr,0,0,PM_REMOVE)) { TranslateMessage(&message); DispatchMessageW(&message); }
            MsgWaitForMultipleObjects(0,nullptr,FALSE,5,QS_ALLINPUT);
        } while (GetTickCount64()<until);
    };
    auto window=[](int x) {
        // STATIC is a control class with its own enable/activation semantics;
        // use an ordinary DefWindowProc top-level for the product availability
        // predicate, and retain standard EDIT controls beneath it.
        return CreateWindowExW(0,L"AzraelKeyboardReservationFixture",L"Azrael keyboard reservation fixture",WS_OVERLAPPEDWINDOW|WS_VISIBLE,
            x,80,340,180,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
    };
    fixture.first=window(80); fixture.second=window(450);
    require(fixture.first && fixture.second,"selftest","Cannot create fixture windows");
    HWND firstEdit=CreateWindowExW(0,L"EDIT",L"xz",WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL,
        20,30,260,30,fixture.first,nullptr,GetModuleHandleW(nullptr),nullptr);
    HWND secondEdit=CreateWindowExW(0,L"EDIT",L"",WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL,
        20,30,260,30,fixture.second,nullptr,GetModuleHandleW(nullptr),nullptr);
    require(firstEdit && secondEdit,"selftest","Cannot create fixture EDIT controls");
    auto available=[](HWND root,const char* stage) {
        const bool visible=IsWindowVisible(root)!=FALSE, enabled=IsWindowEnabled(root)!=FALSE, iconic=IsIconic(root)!=FALSE;
        if (!visible || !enabled || iconic)
            throw Failure("selftest",std::string(stage)+": fixture visible="+(visible?"true":"false")+
                ", enabled="+(enabled?"true":"false")+", iconic="+(iconic?"true":"false"));
    };
    auto activate=[&](HWND root,HWND edit) {
        // windowsHide launchers can supply STARTF_USESHOWWINDOW/SW_HIDE. The
        // first ShowWindow may honor that startup value instead of SW_SHOW;
        // the second call explicitly shows this owned fixture.
        ShowWindow(root,SW_SHOW);
        ShowWindow(root,SW_SHOW);
        EnableWindow(root,TRUE);
        available(root,"fixture activation");
        // A test launched by a background build process may have no foreground
        // activation entitlement. Attach once to the current foreground queue;
        // this route activates only our fixture, without sending any user-app
        // input. Production foreground policy is deliberately unaffected.
        if (GetForegroundWindow()!=root && !SetForegroundWindow(root)) {
            const DWORD self=GetCurrentThreadId();
            const HWND foreground=GetForegroundWindow();
            const DWORD foregroundThread=GetWindowThreadProcessId(foreground,nullptr);
            require(foregroundThread && (foregroundThread==self || AttachThreadInput(self,foregroundThread,TRUE)),
                "selftest","Cannot attach foreground queue for owned fixture activation");
            BringWindowToTop(root);
            SetForegroundWindow(root);
            SetActiveWindow(root);
            if (foregroundThread!=self) AttachThreadInput(self,foregroundThread,FALSE);
        }
        SetFocus(edit); pump();
        require(GetForegroundWindow()==root && GetFocus()==edit,"selftest","Cannot activate owned fixture or establish its edit focus");
    };
    auto queued=[](KeyboardReservation& reservation,DWORD vk) {
        KBDLLHOOKSTRUCT event{}; event.vkCode=vk;
        require(reservation.intercept(event),"selftest","Fixture key down was not buffered");
        event.flags=LLKHF_UP;
        require(reservation.intercept(event),"selftest","Fixture key up was not buffered");
    };
    Signals signals; signals.tag=fixture.tag;
    KeyboardReservation reservation(signals.keyboardReserved,signals.tag);
    activate(fixture.first,firstEdit);
    SendMessageW(firstEdit,EM_SETSEL,1,1);
    available(fixture.first,"plain begin");
    reservation.begin(1000);
    activate(fixture.second,secondEdit);
    queued(reservation,'A'); available(fixture.first,"plain end"); reservation.end(); pump();
    wchar_t text[16]{}; GetWindowTextW(firstEdit,text,16);
    require(GetForegroundWindow()==fixture.first && GetFocus()==firstEdit && std::wstring(text)==L"xaz",
        "selftest","Replay must restore original EDIT and insert A at original caret (Latin input required)");
    require(GetWindowTextLengthW(secondEdit)==0,"selftest","Model fixture must receive no buffered key");
    require(reservation.status().at("replayedEvents")==2 && !reservation.status().at("pending").get<bool>(),
        "selftest","Successful replay must account for every buffered edge");
    require(reservation.buffer.events[0].vk==0 && reservation.buffer.events[1].flags==0,
        "selftest","Consumed key contents must be zeroized without losing statistics");
    SetWindowTextW(firstEdit,L"xy"); SendMessageW(firstEdit,EM_SETSEL,1,1);
    fixture.shift(true); pump();
    require((GetAsyncKeyState(VK_LSHIFT)&0x8000)!=0,"selftest","Fixture Shift did not become held");
    available(fixture.first,"held Shift begin"); reservation.begin(1000); pump();
    require((GetAsyncKeyState(VK_LSHIFT)&0x8000)==0,"selftest","Reservation must neutralize initially held Shift");
    activate(fixture.second,secondEdit);
    queued(reservation,'B'); available(fixture.first,"held Shift end"); reservation.end(); pump();
    GetWindowTextW(firstEdit,text,16);
    require(std::wstring(text)==L"xBy" && (GetAsyncKeyState(VK_LSHIFT)&0x8000)!=0,
        "selftest","Replay must restore initial held Shift before buffered typing");
    fixture.shift(false); pump();
    require((GetAsyncKeyState(VK_LSHIFT)&0x8000)==0,"selftest","Fixture Shift cleanup failed");
    available(fixture.first,"destroyed-origin begin"); reservation.begin(1000);
    activate(fixture.second,secondEdit); queued(reservation,'C');
    DestroyWindow(fixture.first); fixture.first=nullptr;
    bool rejected=false;
    try { reservation.end(); } catch (const Failure&) { rejected=true; }
    pump();
    require(rejected && GetWindowTextLengthW(secondEdit)==0 && reservation.status().at("pending")==true,
        "selftest","Destroyed original must reject restoration without sending buffered keys elsewhere");
    DestroyWindow(fixture.second); fixture.second=nullptr;
    require(fixture.restore(),"selftest","Pre-test foreground/focus restoration failed");
    return 0;
}
} // namespace mp
