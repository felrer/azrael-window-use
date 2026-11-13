#pragma once
#include "mouse-routing.hpp"
namespace mp {
inline int preparationWaitSelftest() {
    MouseRouting routing;
    routing.requested.store(true);
    routing.phase.store(MouseRouting::Phase::awaitingRaw);
    const auto future=GetTickCount64()+86400000ULL;
    routing.tick(future);
    require(routing.phase.load()==MouseRouting::Phase::awaitingRaw,"selftest","Idle preparation must not expire after ten seconds or a day");
    require(!routing.enabled.load()&&!routing.capture.load()&&routing.faults.load()==0,"selftest","Waiting must neither suppress physical input nor claim readiness");
    const auto status=routing.status();
    require(status.at("capability_pending").get<bool>()&&!status.at("failed").get<bool>()&&status.at("probeRemainingMs")==0,"selftest","Idle wait status must remain pending with no active probe countdown");
    routing.phase.store(MouseRouting::Phase::probe);routing.capture.store(true);
    routing.tick(future);
    require(routing.phase.load()==MouseRouting::Phase::failed&&routing.fault.load()==MouseRouting::Fault::rawSurvival&&!routing.capture.load(),"selftest","An expired active probe must still fail and release suppression");
    routing.disable();routing.tick(future);
    require(routing.phase.load()==MouseRouting::Phase::off&&!routing.requested.load(),"selftest","Explicit disable must end idle waiting");
    return 0;
}
}
