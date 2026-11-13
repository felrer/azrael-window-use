#pragma once
#include "platform.hpp"
#include <functional>

namespace mp {
// Validate the complete reservation before focus or any application input changes.
inline unsigned validateBatch(const json& params, const std::function<void(int)>& validateKey) {
    require(params.contains("steps") && params.at("steps").is_array() &&
        !params.at("steps").empty() && params.at("steps").size()<=16,
        "invalid_params","Batch requires 1-16 click/text/press steps");
    const unsigned budget=params.contains("maxMs") ? integer(params,"maxMs",100,1000) : 750;
    size_t textUnits=0;
    for (const auto& step : params.at("steps")) {
        require(step.is_object() && step.contains("action") && step.at("action").is_string(),"invalid_params","Batch step action is required");
        const auto action=step.at("action").get<std::string>();
        require(action=="click" || action=="press" || action=="text","invalid_params","Unsupported batch step action");
        for (auto i=step.begin();i!=step.end();++i)
            require(i.key()=="action" || (action=="click" && (i.key()=="x" || i.key()=="y" || i.key()=="button")) ||
                (action=="text" && i.key()=="text") || (action=="press" && i.key()=="keys"),"invalid_params","Unexpected batch step field");
        if (action=="click") {
            require(step.contains("button") && step.at("button").is_string(),"invalid_params","Batch click button required");
            const auto button=step.at("button").get<std::string>();
            require(button=="left" || button=="right" || button=="middle","invalid_params","Invalid batch click button");
            require(step.contains("x")==step.contains("y"),"invalid_params","Batch click requires paired coordinates");
            if (step.contains("x")) { integer(step,"x",-100000,100000); integer(step,"y",-100000,100000); }
        } else if (action=="text") {
            require(step.contains("text") && step.at("text").is_string(),"invalid_params","Batch text required");
            const auto value=step.at("text").get<std::string>();
            require(!value.empty() && value.size()<=4096,"invalid_params","Batch text exceeds UTF-8 limit");
            textUnits+=wide(value).size();
            require(textUnits<=1024,"invalid_params","Batch total text exceeds 1024 UTF-16 units");
        } else {
            require(step.contains("keys") && step.at("keys").is_array() && !step.at("keys").empty() && step.at("keys").size()<=8,
                "invalid_params","Batch press requires 1-8 concrete keys");
            std::vector<int> keys;
            for (const auto& v : step.at("keys")) {
                const int vk=integer(json{{"vk",v}},"vk",8,254); validateKey(vk);
                require(std::find(keys.begin(),keys.end(),vk)==keys.end(),"invalid_params","Duplicate batch key"); keys.push_back(vk);
            }
            const bool control=std::find(keys.begin(),keys.end(),VK_LCONTROL)!=keys.end() || std::find(keys.begin(),keys.end(),VK_RCONTROL)!=keys.end();
            require(!control || std::find(keys.begin(),keys.end(),VK_ESCAPE)==keys.end(),"unsupported_shortcut","Ctrl+Escape is unsupported");
        }
    }
    return budget;
}
} // namespace mp
