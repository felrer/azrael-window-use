#pragma once
#include "curve-path.hpp"
#include <functional>
namespace mp {
// Retained: future simplification of sampling must not skip anchors, reintroduce
// duplicate-point divisions, or replace centripetal spacing with uniform knots.
inline int curveSelftest() {
    const auto same=[](POINT a,POINT b){return a.x==b.x && a.y==b.y;};
    const auto parse=[](json points){return curve::anchors(json{{"points",points}});};
    const auto line=curve::plan(parse(json::array({json::array({-100,-100}),json::array({100,100})})),1000);
    require(same(line.start,{-100,-100}) && same(line.end,{100,100}),"selftest","Curve lost exact endpoints");
    double previous=0; POINT last=line.start;
    for (const auto& s : line.samples) {
        require(s.point.x==s.point.y && s.fraction>previous && s.fraction<=1,"selftest","Two-point curve must be a monotonic straight line");
        require(std::hypot(static_cast<double>(s.point.x-last.x),static_cast<double>(s.point.y-last.y))<=3.5,"selftest","Curve sample spacing exceeded pixel bound");
        previous=s.fraction; last=s.point;
    }
    const auto p=parse(json::array({json::array({0,0}),json::array({0,100}),json::array({100,100}),json::array({100,0})}));
    const auto c=curve::piece(p[0],p[1],p[2],p[3]);
    const auto middle=(c.a+c.b*3+c.c*3+c.d)/8;
    require(std::abs(middle.x-50)<1e-9 && std::abs(middle.y-112.5)<1e-9,"selftest","Known symmetric Catmull-Rom midpoint differs");
    const auto arc=curve::plan(p,900);
    for (const auto& anchor : p) require(std::any_of(arc.samples.begin(),arc.samples.end(),[&](const curve::Sample& s){return same(s.point,curve::pixel(anchor));}) || same(arc.start,curve::pixel(anchor)),
        "selftest","Curve delivery skipped an exact anchor");
    require(std::any_of(arc.samples.begin(),arc.samples.end(),[](const curve::Sample& s){return s.point.y>=112;}),"selftest","Curve was replaced with a polyline");
    const auto duplicate=parse(json::array({json::array({0,0}),json::array({0,0}),json::array({100,100}),json::array({100,100})}));
    require(duplicate.size()==2 && same(curve::plan(duplicate,300).end,{100,100}),"selftest","Consecutive duplicates must collapse");
    const auto uneven=parse(json::array({json::array({0,0}),json::array({200,100}),json::array({201,101}),json::array({400,0})}));
    const auto u=curve::piece(uneven[0],uneven[1],uneven[2],uneven[3]);
    const auto midpoint=(u.a+u.b*3+u.c*3+u.d)/8;
    // Independent Barry-Goldman knot interpolation reference, not uniform knots.
    require(std::abs(midpoint.x-200.5004620577163)<1e-9 && std::abs(midpoint.y-100.64734814437605)<1e-9,
        "selftest","Uneven anchors lost centripetal parameterization");
    const auto irregular=curve::plan(uneven,500);
    require(irregular.samples.size()<=2048 && irregular.samples.back().fraction==1,"selftest","Uneven anchors must produce a bounded complete path");
    const auto reverse=curve::plan(std::vector<curve::Vec>(uneven.rbegin(),uneven.rend()),500);
    require(std::abs(irregular.length-reverse.length)<1e-7,"selftest","Centripetal curve length must be reversal symmetric");
    const auto rejected=[](const std::function<void()>& f){bool failed=false;try{f();}catch(const Failure&){failed=true;}require(failed,"selftest","Invalid curve was accepted");};
    rejected([&]{parse(json::array({json::array({0,0}),json::array({0,0})}));});
    rejected([&]{parse(json::array({json::array({0,0}),json::array({1.5,2})}));});
    rejected([&]{curve::anchors(json{{"points",json::array({json::array({0,0}),json::array({1,2})})},{"x",4}});});
    rejected([&]{curve::plan(parse(json::array({json::array({0,0}),json::array({100000,100000})})),300);});
    return 0;
}
} // namespace mp
