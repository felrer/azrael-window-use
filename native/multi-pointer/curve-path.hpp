#pragma once
#include "platform.hpp"
#include <cmath>

namespace mp {
// Pure geometry: physical pixel anchors, centripetal Catmull-Rom (alpha=1/2).
// Convert each piece to cubic Bezier, then bound chord error by its control hull.
namespace curve {
struct Vec { double x=0, y=0; };
inline Vec operator+(Vec a,Vec b) { return {a.x+b.x,a.y+b.y}; }
inline Vec operator-(Vec a,Vec b) { return {a.x-b.x,a.y-b.y}; }
inline Vec operator*(Vec a,double n) { return {a.x*n,a.y*n}; }
inline Vec operator/(Vec a,double n) { return {a.x/n,a.y/n}; }
inline double length(Vec a) { return std::hypot(a.x,a.y); }
inline double distance(Vec a,Vec b) { return length(a-b); }
inline Vec mix(Vec a,Vec b,double f) { return a*(1-f)+b*f; }
inline double chordDistance(Vec p,Vec a,Vec b) {
    const auto d=b-a; const double square=d.x*d.x+d.y*d.y;
    const double f=square ? std::clamp(((p-a).x*d.x+(p-a).y*d.y)/square,0.0,1.0) : 0;
    return distance(p,mix(a,b,f));
}
struct Cubic { Vec a,b,c,d; };
inline Cubic piece(Vec p0,Vec p1,Vec p2,Vec p3) {
    const double h0=std::sqrt(distance(p0,p1)),h1=std::sqrt(distance(p1,p2)),h2=std::sqrt(distance(p2,p3));
    const auto m1=((p1-p0)/h0-(p2-p0)/(h0+h1)+(p2-p1)/h1)*h1;
    const auto m2=((p2-p1)/h1-(p3-p1)/(h1+h2)+(p3-p2)/h2)*h1;
    return {p1,p1+m1/3,p2-m2/3,p2};
}
inline void flatten(const Cubic& c,std::vector<Vec>& out,unsigned depth=0) {
    require(out.size()<16384,"path_too_complex","Curve subdivision exceeds the bounded path capacity");
    if (std::max(chordDistance(c.b,c.a,c.d),chordDistance(c.c,c.a,c.d))<=0.25) { out.push_back(c.d); return; }
    require(depth<18,"path_too_complex","Curve subdivision could not meet the geometric tolerance");
    const auto ab=mix(c.a,c.b,0.5),bc=mix(c.b,c.c,0.5),cd=mix(c.c,c.d,0.5);
    const auto abc=mix(ab,bc,0.5),bcd=mix(bc,cd,0.5),mid=mix(abc,bcd,0.5);
    flatten({c.a,ab,abc,mid},out,depth+1); flatten({mid,bcd,cd,c.d},out,depth+1);
}
inline std::vector<Vec> anchors(const json& params) {
    require(!params.contains("x") && !params.contains("y") && !params.contains("fromX") && !params.contains("fromY"),
        "invalid_params","Curve points cannot be combined with endpoint coordinates");
    const auto& points=params.at("points");
    require(points.is_array() && points.size()>=2 && points.size()<=32,"invalid_params","Curve drag requires 2-32 physical pixel coordinate pairs");
    std::vector<Vec> out;
    for (const auto& p : points) {
        require(p.is_array() && p.size()==2,"invalid_params","Curve point must be an [x,y] pair");
        const Vec v{static_cast<double>(integer(json{{"x",p[0]}},"x",-100000,100000)),
            static_cast<double>(integer(json{{"y",p[1]}},"y",-100000,100000))};
        if (out.empty() || distance(out.back(),v)>0) out.push_back(v);
    }
    require(out.size()>=2,"invalid_params","Curve drag requires at least two distinct consecutive points");
    return out;
}
inline POINT pixel(Vec v) {
    require(std::isfinite(v.x) && std::isfinite(v.y) && std::abs(v.x)<=1000000 && std::abs(v.y)<=1000000,
        "invalid_params","Curve generated an invalid coordinate");
    return {static_cast<LONG>(std::lround(v.x)),static_cast<LONG>(std::lround(v.y))};
}
struct Sample { POINT point; double fraction; };
struct Path { POINT start{},end{}; std::vector<Sample> samples; double length=0; };
inline Path plan(const std::vector<Vec>& points,unsigned duration) {
    require(points.size()>=2,"invalid_params","Curve requires distinct anchors");
    struct Segment { std::vector<Vec> points; std::vector<double> cumulative; double length=0; };
    std::vector<Segment> segments;
    Path path; path.start=pixel(points.front()); path.end=pixel(points.back());
    for (size_t i=0;i+1<points.size();++i) {
        const auto p1=points[i],p2=points[i+1];
        const auto p0=i?points[i-1]:p1*2-p2,p3=i+2<points.size()?points[i+2]:p2*2-p1;
        Segment s; s.points.push_back(p1); s.cumulative.push_back(0);
        flatten(piece(p0,p1,p2,p3),s.points);
        for (size_t j=1;j<s.points.size();++j) { s.length+=distance(s.points[j-1],s.points[j]); s.cumulative.push_back(s.length); }
        require(s.length>0 && std::isfinite(s.length),"invalid_params","Degenerate curve segment");
        path.length+=s.length; segments.push_back(std::move(s));
    }
    double traveled=0;
    for (const auto& s : segments) {
        // <=2px of the flattened curve per event; <=10ms intended cadence.
        const double desired=std::max(std::ceil(s.length/2),std::ceil(duration*s.length/path.length/10));
        require(desired<=2048 && path.samples.size()+static_cast<size_t>(desired)<=2048,
            "path_too_complex","Curve exceeds 2048 delivery samples; split it into shorter strokes");
        const size_t count=std::max<size_t>(1,static_cast<size_t>(desired)); size_t index=1;
        for (size_t j=1;j<=count;++j) {
            const double at=s.length*static_cast<double>(j)/count;
            while (index+1<s.cumulative.size() && s.cumulative[index]<at) ++index;
            const double span=s.cumulative[index]-s.cumulative[index-1];
            const auto p=j==count?s.points.back():mix(s.points[index-1],s.points[index],span?(at-s.cumulative[index-1])/span:0);
            path.samples.push_back({pixel(p),(traveled+at)/path.length});
        }
        traveled+=s.length;
    }
    path.samples.back().point=path.end; path.samples.back().fraction=1;
    return path;
}
} // namespace curve
} // namespace mp
