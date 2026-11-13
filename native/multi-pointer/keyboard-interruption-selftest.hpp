#pragma once
#include "overlay.hpp"
namespace mp {
inline int keyboardInterruptionSelftest() {
    Signals signals;
    KBDLLHOOKSTRUCT event{}; event.vkCode=VK_LSHIFT;
    require(signals.observeForeignKeyboard(WM_KEYDOWN,event),"selftest","Ordinary input must retain keyboard interruption");
    signals.collaborationRequested.store(true);
    require(signals.allowsPhysicalModifier(VK_LSHIFT)&&signals.allowsPhysicalModifier(VK_LWIN)&&!signals.allowsPhysicalModifier(VK_XBUTTON1),"selftest","Mouse operations must tolerate modifiers without ignoring held mouse buttons");
    const auto baseline=signals.epoch.load();
    require(!signals.observeForeignKeyboard(WM_KEYDOWN,event),"selftest","Virtualized mouse must tolerate physical keyboard");
    require(signals.epoch.load()==baseline && signals.physical[VK_LSHIFT].load(),"selftest","Keyboard must be observed without interrupting mouse");
    require(!signals.observeForeignKeyboard(WM_KEYUP,event) && !signals.physical[VK_LSHIFT].load(),"selftest","Physical release must still be tracked");
    {
        Signals::KeyboardOperation operation(signals,true);
        require(!signals.allowsPhysicalModifier(VK_LSHIFT),"selftest","Model keyboard operation retains modifier gate");
        require(signals.observeForeignKeyboard(WM_KEYDOWN,event),"selftest","Model keyboard operations retain conflict handling");
    }
    require(!signals.modelKeyboardActive.load(),"selftest","Keyboard operation scope must reset");
    event.flags=LLKHF_INJECTED;
    require(signals.observeForeignKeyboard(WM_KEYUP,event),"selftest","Foreign injection must still interrupt");
    require(signals.foreignKeyboard.load()==5,"selftest","All external keyboard events must remain counted");
    signals.emergency.store(true);signals.explicitStop.store(true);signals.disconnected.store(true);
    event.flags=0;signals.observeForeignKeyboard(WM_KEYUP,event);
    require(signals.emergency.load()&&signals.explicitStop.load()&&signals.disconnected.load(),"selftest","Concurrent keyboard must never clear stop or disconnect");
    return 0;
}
}
