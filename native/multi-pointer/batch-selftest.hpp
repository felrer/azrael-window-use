#pragma once
#include "broker.hpp"
namespace mp {
inline int batchSelftest() {
    const auto key=[](int vk) { require(vk!=VK_CONTROL,"invalid_params","Concrete keys required"); };
    const json valid{{"steps",json::array({json{{"action","click"},{"button","left"},{"x",10},{"y",20}},
        json{{"action","text"},{"text","hello"}},json{{"action","press"},{"keys",json::array({VK_RETURN})}}})}};
    require(validateBatch(valid,key)==750,"selftest","Batch default budget differs from public contract");
    auto rejects=[&](json packet) { bool failed=false; try { validateBatch(packet,key); } catch (const Failure&) { failed=true; }
        require(failed,"selftest","Malformed batch was accepted"); };
    auto bad=valid; bad["steps"][2]["keys"]=json::array({VK_CONTROL}); rejects(bad);
    bad=valid; bad["steps"][2]["operationId"]=3; rejects(bad);
    bad=valid; bad["steps"][0].erase("y"); rejects(bad);
    bad=valid; bad["maxMs"]=2001; rejects(bad);
    bad=valid; bad["steps"][1]["text"]=std::string(1025,'a'); rejects(bad);
    bad=valid; bad["steps"].push_back(json{{"action","batch"},{"steps",json::array()}}); rejects(bad);
    auto delayed=valid; delayed["maxMs"]=2000;
    delayed["steps"].push_back(json{{"action","wait"},{"durationMs",1000}});
    require(validateBatch(delayed,key)==2000,"selftest","A 1000ms wait must fit an explicit 2000ms reservation");
    bad=delayed; bad.erase("maxMs"); rejects(bad);
    bad=delayed; bad["steps"].push_back(delayed["steps"].back()); rejects(bad);
    for (const auto& duration : {json(0),json(1001),json(1.5)}) {
        bad=delayed; bad["steps"].back()["durationMs"]=duration; rejects(bad);
    }
    Operations ledger;
    auto operation=ledger.admit("batch",valid,1);
    require(operation.second,"selftest","Batch must admit as one operation");
    operation.first->applicationInputs=1;
    const auto duplicate=ledger.admit("batch",valid,1);
    require(!duplicate.second && duplicate.first==operation.first && duplicate.first->applicationInputs==1,
        "selftest","Duplicate batch must reuse outcome without replaying its prefix");
    return 0;
}
} // namespace mp
