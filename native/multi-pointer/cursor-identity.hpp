#pragma once
#include "platform.hpp"
#include "cursor-assets.hpp"

namespace mp {
// Named object handles reserve presentation identities across independent MCP
// processes in this Windows logon session. No file, polling or stale PID record;
// Windows releases the reservation even when a broker crashes.
class CursorIdentity {
    Handle numberLease, colorLease;
    static Handle reserve(const std::wstring& suffix) {
        const auto name=L"Local\\Azrael.WindowUse.Cursor.v1."+suffix;
        HANDLE value=CreateMutexW(nullptr,FALSE,name.c_str());
        const DWORD error=GetLastError();
        require(value!=nullptr,"overlay","Cannot reserve cursor presentation identity");
        if (error==ERROR_ALREADY_EXISTS) { CloseHandle(value); return Handle{}; }
        return Handle(value);
    }
public:
    unsigned number=0;
    COLORREF color=0;
    std::wstring label;
    CursorIdentity(COLORREF requested,bool automatic) {
        for (unsigned candidate=1;candidate<=4096;++candidate) {
            auto lease=reserve(L"Agent."+std::to_wstring(candidate));
            if (lease.value) { numberLease=std::move(lease); number=candidate; break; }
        }
        require(number!=0,"overlay","No free cursor presentation number");
        label=L"Agent "+std::to_wstring(number);
        if (!automatic) {
            colorLease=reserve(L"Color."+std::to_wstring(requested));
            require(colorLease.value!=nullptr,"overlay","Requested cursor color is already visible");
            color=requested;
        } else {
            // Prefer contrasting hue families before using another tone.
            constexpr size_t order[]{0,4,2,6,3,5,7,11,8,9,1,10};
            for (unsigned tone=0;tone<6 && !colorLease.value;++tone) for (size_t index:order) {
                const auto& f=cursor_assets::palette[index];
                const uint32_t tones[]{f.bright,f.deep,f.clear,f.luminous,f.pastel,f.porcelain};
                const auto rgb=tones[tone];
                const auto candidate=RGB((rgb>>16)&255,(rgb>>8)&255,rgb&255);
                auto lease=reserve(L"Color."+std::to_wstring(candidate));
                if (lease.value) { colorLease=std::move(lease); color=candidate; break; }
            }
            require(colorLease.value!=nullptr,"overlay","All 72 cursor colors are currently reserved");
        }
    }
};
} // namespace mp
