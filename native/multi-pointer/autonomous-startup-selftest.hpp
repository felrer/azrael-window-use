#pragma once
#include "mouse-routing.hpp"
namespace mp {
// Future startup checks must not accidentally require an observed human event.
inline int autonomousStartupSelftest() {
    HWND controller=CreateWindowExW(0,L"STATIC",L"",0,0,0,0,0,HWND_MESSAGE,nullptr,GetModuleHandleW(nullptr),nullptr);
    require(controller!=nullptr,"selftest","Cannot create Raw Input controller");
    MouseRouting routing;
    try {
        routing.enable(controller);
        const auto status=routing.status();
        require(status.at("requested")==true && status.at("enabled")==true && status.at("phase")=="ready" &&
            status.at("capability_pending")==false,"selftest","Initialization must be ready synchronously without physical input");
        require(!routing.capture.load() && routing.rawPackets.load()==0 && routing.suppressed.load()==0,
            "selftest","Startup must neither wait for Raw Input nor suppress an idle user");
        routing.tick(GetTickCount64()+86400000ULL);
        routing.beginModel();
        require(routing.modelActive.load() && routing.capture.load(),"selftest","Model must begin before any physical Raw Input");
        routing.endModel(); routing.disable();
        routing.tick(GetTickCount64()+86400000ULL);
        require(routing.phase.load()==MouseRouting::Phase::off && !routing.requested.load() && !routing.capture.load(),
            "selftest","Disable must release routing after autonomous startup");
        routing.enable(nullptr);
        require(routing.phase.load()==MouseRouting::Phase::failed && !routing.enabled.load() && !routing.capture.load(),
            "selftest","Actual Raw Input registration failure must remain a failure, never a preparation wait");
        routing.disable(); DestroyWindow(controller); return 0;
    } catch (...) { routing.disable(); DestroyWindow(controller); throw; }
}
}
