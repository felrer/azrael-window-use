#pragma once
#include "platform.hpp"

namespace mp {
// Independent of the input worker and UI message pump. Only inherited handles
// identify the watched helper; never find/kill a process by PID or executable.
class InputSafety {
public:
    static constexpr uint64_t hardLimitMs=10000, cleanupMs=250;
    struct alignas(8) Shared {
        volatile LONG mask=0, abort=0, ready=0, stop=0, escapeHeld=0;
        alignas(8) volatile LONG64 started=0, heartbeat=0, abortAt=0;
        ULONG_PTR tag=0;
        volatile LONG keys[256]{}, unicode[2048]{}, buttons=0;
    };
    // UI-thread state; a lease covers the union of keyboard and mouse gates.
    static void gate(Shared& s,LONG bit,bool enabled,uint64_t now) noexcept {
        const LONG before=read(s.mask);
        if (enabled && !before) InterlockedExchange64(&s.started,static_cast<LONG64>(now));
        InterlockedExchange(&s.mask,enabled ? before|bit : before&~bit);
    }
    static bool escape(Shared& s,const KBDLLHOOKSTRUCT& e,uint64_t now) noexcept {
        if (e.vkCode!=VK_ESCAPE || (e.flags&LLKHF_INJECTED)) return false;
        const bool up=(e.flags&LLKHF_UP)!=0;
        if (!read(s.escapeHeld) && (up || !read(s.mask))) return false;
        InterlockedExchange(&s.escapeHeld,up?0:1);
        if (!up) trip(s,1,now);
        return true; // consume repeats and the matching release, even after cleanup
    }
    static LONG read(volatile LONG& value) noexcept { return InterlockedCompareExchange(&value,0,0); }
    static uint64_t read64(volatile LONG64& value) noexcept { return static_cast<uint64_t>(InterlockedCompareExchange64(&value,0,0)); }
    static void trip(Shared& s,LONG reason,uint64_t now) noexcept {
        if (InterlockedCompareExchange(&s.abort,reason,0)==0)
            InterlockedExchange64(&s.abortAt,static_cast<LONG64>(now));
    }
    static void check(Shared& s,uint64_t now) noexcept {
        if (!read(s.mask)) return;
        const auto began=read64(s.started), heartbeat=read64(s.heartbeat);
        if (now-began>=hardLimitMs-cleanupMs) trip(s,2,now);
        else if (now-heartbeat>=1500) trip(s,3,now);
    }
    static bool protectKeyboardRelease(Shared& s,const KBDLLHOOKSTRUCT& e,bool held) noexcept {
        // Emergency Esc is deliberately consumed, including its physical UP;
        // do not leave a partially delivered model Esc held on its behalf.
        return held && (e.flags&LLKHF_INJECTED) && (e.flags&LLKHF_UP) && e.dwExtraInfo==s.tag &&
            !(e.vkCode==VK_ESCAPE && read(s.escapeHeld));
    }
private:
    Handle mapping, child;
    Shared* shared=nullptr;
    inline static Shared* hookState=nullptr;
    inline static std::array<bool,256> physicalKeys{};
    inline static std::array<bool,3> physicalButtons{};
    inline static bool releasingModel=false;
    static LRESULT CALLBACK hook(int code,WPARAM wp,LPARAM lp) {
        if (code==HC_ACTION && hookState) {
            const auto& e=*reinterpret_cast<const KBDLLHOOKSTRUCT*>(lp);
            const bool up=(e.flags&LLKHF_UP)!=0;
            if (!(e.flags&LLKHF_INJECTED) && e.vkCode<256) physicalKeys[e.vkCode]=!up;
            if (escape(*hookState,e,GetTickCount64())) return 1;
            // Test at hook delivery, not before SendInput: a physical down can
            // arrive between preparing a recovery release and its insertion.
            if (releasingModel && e.vkCode<256 && protectKeyboardRelease(*hookState,e,physicalKeys[e.vkCode])) return 1;
        }
        return CallNextHookEx(nullptr,code,wp,lp);
    }
    static LRESULT CALLBACK mouseHook(int code,WPARAM wp,LPARAM lp) {
        if (code==HC_ACTION && hookState) {
            const auto& e=*reinterpret_cast<const MSLLHOOKSTRUCT*>(lp);
            int button=-1; bool up=false;
            switch(wp) {
            case WM_LBUTTONDOWN: button=0; break;
            case WM_LBUTTONUP: button=0; up=true; break;
            case WM_RBUTTONDOWN: button=1; break;
            case WM_RBUTTONUP: button=1; up=true; break;
            case WM_MBUTTONDOWN: button=2; break;
            case WM_MBUTTONUP: button=2; up=true; break;
            default: break;
            }
            if (button>=0) {
                if (!(e.flags&LLMHF_INJECTED)) physicalButtons[button]=!up;
                else if (releasingModel && up && e.dwExtraInfo==hookState->tag && physicalButtons[button]) return 1;
            }
        }
        return CallNextHookEx(nullptr,code,wp,lp);
    }
    static std::wstring argument(HANDLE value) { return std::to_wstring(reinterpret_cast<uintptr_t>(value)); }
    static bool releaseModel(Shared& s) noexcept {
        bool ok=true;
        auto send=[&](INPUT e) {
            if (e.type==INPUT_KEYBOARD) e.ki.dwExtraInfo=s.tag; else e.mi.dwExtraInfo=s.tag;
            if (SendInput(1,&e,sizeof(e))!=1) ok=false;
        };
        for (unsigned vk=1;vk<256;++vk) if (const LONG flags=read(s.keys[vk])) {
            INPUT e{}; e.type=INPUT_KEYBOARD; e.ki.wVk=static_cast<WORD>(vk);
            e.ki.dwFlags=KEYEVENTF_KEYUP | (flags==2 ? KEYEVENTF_EXTENDEDKEY : 0); send(e);
        }
        for (unsigned scan=0;scan<65536;++scan) if (read(s.unicode[scan/32]) & (1UL<<(scan%32))) {
            INPUT e{}; e.type=INPUT_KEYBOARD; e.ki.wScan=static_cast<WORD>(scan);
            e.ki.dwFlags=KEYEVENTF_UNICODE|KEYEVENTF_KEYUP; send(e);
        }
        const DWORD ups[]{MOUSEEVENTF_LEFTUP,MOUSEEVENTF_RIGHTUP,MOUSEEVENTF_MIDDLEUP};
        const LONG buttons=read(s.buttons);
        for (unsigned n=0;n<3;++n) if (buttons&(1<<n)) {
            INPUT e{}; e.type=INPUT_MOUSE; e.mi.dwFlags=ups[n]; send(e);
        }
        return ok;
    }
public:
    InputSafety()=default;
    InputSafety(const InputSafety&)=delete;
    InputSafety& operator=(const InputSafety&)=delete;
    void start(ULONG_PTR tag) {
        require(!shared,"input_safety","Input safety guard already started");
        SECURITY_ATTRIBUTES sa{sizeof(sa),nullptr,TRUE};
        mapping=Handle(CreateFileMappingW(INVALID_HANDLE_VALUE,&sa,PAGE_READWRITE,0,sizeof(Shared),nullptr));
        Handle parent(OpenProcess(SYNCHRONIZE|PROCESS_TERMINATE,TRUE,GetCurrentProcessId()));
        require(mapping.value && parent.value,"input_safety","Cannot create input safety channel");
        shared=static_cast<Shared*>(MapViewOfFile(mapping.value,FILE_MAP_ALL_ACCESS,0,0,sizeof(Shared)));
        require(shared,"input_safety","Cannot map input safety channel");
        shared->tag=tag; InterlockedExchange64(&shared->heartbeat,static_cast<LONG64>(GetTickCount64()));
        wchar_t executable[32768]{};
        require(GetModuleFileNameW(nullptr,executable,32768)!=0,"input_safety","Cannot locate input safety executable");
        std::wstring command=L"\""+std::wstring(executable)+L"\" --input-safety-guard "+argument(mapping.value)+L" "+argument(parent.value);
        SIZE_T bytes=0; InitializeProcThreadAttributeList(nullptr,1,0,&bytes);
        std::vector<unsigned char> storage(bytes); STARTUPINFOEXW startup{}; startup.StartupInfo.cb=sizeof(startup);
        startup.StartupInfo.dwFlags=STARTF_USESHOWWINDOW; startup.StartupInfo.wShowWindow=SW_HIDE;
        startup.lpAttributeList=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
        require(InitializeProcThreadAttributeList(startup.lpAttributeList,1,0,&bytes)!=FALSE,"input_safety","Cannot initialize guard startup");
        Handle nullIo(CreateFileW(L"NUL",GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,&sa,OPEN_EXISTING,0,nullptr));
        HANDLE errorCopy=nullptr;
        DuplicateHandle(GetCurrentProcess(),GetStdHandle(STD_ERROR_HANDLE),GetCurrentProcess(),&errorCopy,0,TRUE,DUPLICATE_SAME_ACCESS);
        Handle errorIo(errorCopy);
        startup.StartupInfo.dwFlags|=STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput=startup.StartupInfo.hStdOutput=nullIo.value;
        startup.StartupInfo.hStdError=errorIo.value?errorIo.value:nullIo.value;
        std::vector<HANDLE> handles{mapping.value,parent.value,nullIo.value};
        if (errorIo.value) handles.push_back(errorIo.value);
        PROCESS_INFORMATION process{};
        const BOOL listed=UpdateProcThreadAttribute(startup.lpAttributeList,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,handles.data(),handles.size()*sizeof(HANDLE),nullptr,nullptr);
        const BOOL launched=listed && CreateProcessW(executable,command.data(),nullptr,nullptr,TRUE,EXTENDED_STARTUPINFO_PRESENT|CREATE_NO_WINDOW,
            nullptr,nullptr,&startup.StartupInfo,&process);
        DeleteProcThreadAttributeList(startup.lpAttributeList);
        for (auto handle:handles) SetHandleInformation(handle,HANDLE_FLAG_INHERIT,0);
        require(launched!=FALSE,"input_safety","Cannot launch input safety guard");
        CloseHandle(process.hThread); child=Handle(process.hProcess);
        const auto until=GetTickCount64()+1500;
        // Guard installs its Esc hook after the broker hooks, before any gate.
        while (!read(shared->ready) && WaitForSingleObject(child.value,0)==WAIT_TIMEOUT && GetTickCount64()<until) Sleep(5);
        require(read(shared->ready)==1 && healthy(),"input_safety","Input safety hook unavailable");
    }
    bool healthy() const noexcept { return shared && child.value && WaitForSingleObject(child.value,0)==WAIT_TIMEOUT && !read(shared->abort); }
    void setGate(LONG bit,bool enabled) {
        if (enabled) require(healthy(),"input_safety","Input safety guard is unavailable or stopped; suppression refused");
        if (enabled) tick();
        if (shared) gate(*shared,bit,enabled,GetTickCount64());
        if (enabled) require(healthy(),"input_safety","Input safety cancellation raced suppression startup");
    }
    bool aborted() const noexcept { return shared && read(shared->abort)!=0; }
    bool unavailable() const noexcept { return shared && !healthy(); }
    bool consumeEscape(const KBDLLHOOKSTRUCT& e) noexcept {
        return shared && escape(*shared,e,GetTickCount64());
    }
    void tick() noexcept { if (shared) InterlockedExchange64(&shared->heartbeat,static_cast<LONG64>(GetTickCount64())); }
    // Publish downs before insertion, clear ups only after confirmed insertion.
    // An unsent conservative down can cause an extra release, never a replay.
    void record(const INPUT& e,bool before) noexcept {
        if (!shared) return;
        if (e.type==INPUT_KEYBOARD) {
            const bool up=(e.ki.dwFlags&KEYEVENTF_KEYUP)!=0;
            if (before==up) return;
            if (e.ki.dwFlags&KEYEVENTF_UNICODE) {
                auto& word=shared->unicode[e.ki.wScan/32]; const LONG bit=static_cast<LONG>(1UL<<(e.ki.wScan%32));
                if (up) InterlockedAnd(&word,~bit); else InterlockedOr(&word,bit);
            } else if (e.ki.wVk<256) InterlockedExchange(&shared->keys[e.ki.wVk],up?0:(e.ki.dwFlags&KEYEVENTF_EXTENDEDKEY?2:1));
        } else if (e.type==INPUT_MOUSE) {
            const DWORD downs[]{MOUSEEVENTF_LEFTDOWN,MOUSEEVENTF_RIGHTDOWN,MOUSEEVENTF_MIDDLEDOWN};
            const DWORD ups[]{MOUSEEVENTF_LEFTUP,MOUSEEVENTF_RIGHTUP,MOUSEEVENTF_MIDDLEUP};
            for (unsigned n=0;n<3;++n) {
                if (before && (e.mi.dwFlags&downs[n])) InterlockedOr(&shared->buttons,1<<n);
                if (!before && (e.mi.dwFlags&ups[n])) InterlockedAnd(&shared->buttons,~(1<<n));
            }
        }
    }
    void clearModel() noexcept {
        if (!shared) return;
        for (auto& key:shared->keys) InterlockedExchange(&key,0);
        for (auto& word:shared->unicode) InterlockedExchange(&word,0);
        InterlockedExchange(&shared->buttons,0);
    }
    json status() const {
        return {{"ready",healthy()},{"hardLimitMs",hardLimitMs},{"abortReason",shared?read(shared->abort):0},
            {"suppressionActive",shared && read(shared->mask)!=0}};
    }
    ~InputSafety() {
        if (shared) {
            InterlockedExchange(&shared->stop,1);
            if (child.value) WaitForSingleObject(child.value,1000);
            UnmapViewOfFile(shared);
        }
    }
    static int guardMain(int argc,wchar_t** argv) {
        if (argc!=4) return 2;
        auto parse=[](const wchar_t* text)->HANDLE { wchar_t* end=nullptr; const auto v=_wcstoui64(text,&end,10);
            return v && end && !*end ? reinterpret_cast<HANDLE>(static_cast<uintptr_t>(v)):nullptr; };
        Handle mapping(parse(argv[2])), parent(parse(argv[3]));
        if (!mapping.value || !parent.value) return 2;
        auto* s=static_cast<Shared*>(MapViewOfFile(mapping.value,FILE_MAP_ALL_ACCESS,0,0,sizeof(Shared)));
        if (!s) return 2;
        hookState=s;
        physicalKeys.fill(false); physicalButtons.fill(false); releasingModel=false;
        HHOOK keyboard=SetWindowsHookExW(WH_KEYBOARD_LL,hook,GetModuleHandleW(nullptr),0);
        HHOOK mouse=SetWindowsHookExW(WH_MOUSE_LL,mouseHook,GetModuleHandleW(nullptr),0);
        // Seed after installing hooks but before acknowledging readiness or any
        // suppression. Subsequent queued physical edges reconcile the snapshot.
        for (unsigned vk=1;vk<256;++vk) physicalKeys[vk]=(GetAsyncKeyState(vk)&0x8000)!=0;
        const unsigned buttonVks[]{VK_LBUTTON,VK_RBUTTON,VK_MBUTTON};
        for (unsigned n=0;n<3;++n) physicalButtons[n]=(GetAsyncKeyState(buttonVks[n])&0x8000)!=0;
        InterlockedExchange(&s->ready,keyboard && mouse?1:-1);
        bool recovered=false, released=true, releasedOnce=false, terminationRequested=false, terminationFailureLogged=false;
        uint64_t exitAt=0;
        while (keyboard && mouse) {
            MSG message{}; while (PeekMessageW(&message,nullptr,0,0,PM_REMOVE)) DispatchMessageW(&message);
            const auto now=GetTickCount64(); check(*s,now);
            const bool alive=WaitForSingleObject(parent.value,0)==WAIT_TIMEOUT;
            const auto abortAt=read64(s->abortAt), started=read64(s->started);
            const bool forced=read(s->mask) && ((read(s->abort) && abortAt && now-abortAt>=cleanupMs) || now-started>=hardLimitMs);
            if (forced && alive) {
                // No focus changes or buffer replay until the injector is dead.
                if (!terminationRequested) terminationRequested=TerminateProcess(parent.value,74)!=FALSE;
                if (WaitForSingleObject(parent.value,100)==WAIT_OBJECT_0) recovered=true;
                else if (!terminationFailureLogged) {
                    diagnostic("ERROR","input_safety_termination_pending"); terminationFailureLogged=true;
                }
                // Keep the guardian alive and pumping on failure/slow teardown.
                // A natural-exit race must still reach releaseModel below.
            }
            if (!alive || recovered) {
                if (!releasedOnce) {
                    releasingModel=true;
                    released=releaseModel(*s); releasedOnce=true;
                    if (read(s->mask) || recovered)
                        diagnostic(released?"WARN":"ERROR","input_safety_fail_open","buffer_delivery_unknown_no_replay");
                }
                gate(*s,1,false,now); gate(*s,2,false,now);
                if (!exitAt) exitAt=now+hardLimitMs;
                if (!read(s->escapeHeld) || now>=exitAt) break;
            } else if (read(s->stop) && !read(s->mask) && !read(s->escapeHeld)) break;
            MsgWaitForMultipleObjects(0,nullptr,FALSE,5,QS_ALLINPUT);
        }
        if (keyboard) UnhookWindowsHookEx(keyboard);
        if (mouse) UnhookWindowsHookEx(mouse);
        hookState=nullptr; UnmapViewOfFile(s); return released?0:4;
    }
};
} // namespace mp
