상태: 선택적 UIA capture 구현·검증·커밋·MCP 적용 완료. 사용자가 삭제 잠금 도구 개편 중 임시 빌드 자료를 그대로 두도록 명시 승인하여 보관 예외로 종료함. 개편 후 지원 경로에서 정리 재검토.

# 독립 MCP 안내 정리

## 후속: 선택적 UIA 통합 캡처

사용자는 capture에 선택적 UIA 조회를 추가하고 기본은 이미지 전용을 유지하도록 승인했다. includeUIA:boolean(default false)을 공개 스키마·호스트 검증·네이티브 프로토콜로 전달한다. true이면 기존 bounded summary(최대 20개)를 재사용하고 이미지 및 요소를 하나의 observationId에 보관해 요소 동작 또는 포인터 입력 중 하나를 허용한다. UIA coverage와 잘림 정보를 반환하며 이미지/UIA는 순차 샘플링이고 원자적 UI 스냅샷이라고 주장하지 않는다. 대상·크기·DPI 검증과 권한·보호 앱·입력 후 참조 무효화는 유지한다. standalone Windows x64만 구현하고 내장판·배포 패키지는 변경하지 않는다.

기존 image-input 계약 검사에 선택 옵션 전달, 기본/false, 통합 결과 직렬화, 동일 ID의 두 입력 경로 및 소비 후 거절을 추가한다. 나중에 캡처 경로를 단순화하면서 요소 참조 또는 기본 이미지 전용을 누락할 수 있으므로 기존 검사에 유지한다. 네이티브 protocol 검사도 엄격한 옵션 타입과 default를 확인한다. 최초 JS 실행에서 새 검증 오류 문구가 기존 문자열 분류기로 unclassified가 되어 실패했다. 새 검증에 invalid_request를 명시하고 재검증한다.

루트 소유 임시 빌드·검증 경로는 artifacts/verification/capture-uia-run/이다. 빌드 전 native/window-control 입력을 inputs/에 고정하고 target/·logs/·명령 파일·검증 fixture를 같은 경계에 생성한다. 새 사용 런타임은 artifacts/local/capture-uia-connected/runtime/에 게시하며 기존 연결 런타임을 덮어쓰지 않는다. 실제 사용 런타임과 최소 receipt는 유지할 전달물이며, 중간 빌드·fixture는 생산자 종료와 참조 해제 후 등록된 관리 도구로 삭제한다.

최종 소스 커밋은 7646dc0이다. Windows 전체 JS 검사 30/30 exit 0(1794751519805432-8328-16014), Rust 단위 검사 35 통과/4 ignored 및 release 빌드 exit 0. 고정 입력은 빌드 후 원본과 동일했다. 실제 소유 WinForms 창에서 image-only 기본/명시 false, 통합 UIA 11개와 PNG, 동일 ID invoke 효과, 소비 후 재실행 거절, set_value 후 새 UIA read 확인이 통과했다(1794751526933709-8328-16042). 초기 두 live 실패는 숨겨 실행한 테스트 창이 열거되지 않아 발생했으며 일반 표시로 고쳐 통과했다. 최초 JS 두 실패는 새 옵션의 오류 코드 및 기존 DPI 변경 fixture를 후속 검사 전에 초기화하지 않은 문제였으며 수정 후 통과했다. 네이티브 재빌드는 없었다.

현재 연결의 runtime-directory만 새 런타임으로 변경하고 MCP를 새로고침했다. 실제 연결의 guide 7, false 요소 0개/image-only, true 요소 11개/complete와 양쪽 PNG를 확인했다. 테스트 창과 별도 네이티브 프로세스는 종료했다. 유지할 실행물·최소 근거는 artifacts/local/capture-uia-connected/build-evidence.json에 있다. 그 실행물은 임시 컴파일 디렉터리·프로필·로그에 의존하지 않는다.

정리 검토에서 이전 프로젝트 소유자 window-use-public-mcp가 artifacts/verification 전체를 등록한 기존 상위 claim과 새 하위 run(등록 소유자 standalone-capture-uia)이 겹치는 것이 확인됐다. 검토는 overlapping lifecycle member requires its own whole-group decision으로 삭제를 차단했다. 등록을 기존 프로젝트 소유자로 정정하려 했으나 existing group ownership and kind cannot change로 거절됐다. 실제 소유자 기록은 변경되지 않았다. 기존 상위 claim과 다른 하위 claim·파일은 보존했다. 지원되는 retire_nested_member는 같은 소유자만 허용하므로 현재 두 그룹에 적용할 수 없다. 원시 registry 수정·직접 삭제·이동으로 우회하지 않았다. 임시 run의 생성자와 fixture는 종료했고 독립 검증은 위 receipt로 이전했지만 실제 649,050,552 bytes가 남았다. 프로젝트 유지보수 소유자의 추가 수정 범위가 결정되고 지원 경로가 마련될 때 다시 검토·삭제해야 한다. 보관 승인을 받은 것으로 취급하지 않고 정리 대기로 유지한다.

## 후속: UIA 도구 선택 안내

사용자의 요청으로 Window Use 내부에서 텍스트·값·상태는 inspect, 지원하는 컨트롤은 invoke/set_value를 우선하고 시각 판단·그림·드래그는 캡처/포인터를 쓰도록 안내를 개선했다. 외부 도구 선택 우선순위는 추가하지 않았다. guideVersion은 standalone-window-use-6이다. 입력 스키마와 실행 정책은 변경하지 않는다. 제품 범위는 Windows x64 대화형 데스크톱이며 이번 검증은 Windows에서 수행했다.

네이티브 observe 구현은 이미 UIA 추출 없이 이미지와 빈 요소 배열을 반환한다. 앞선 응답에서 capture에 UIA 추출 비용이 있다고 설명한 부분은 잘못이었으며 사용자에게 정정했다. capture와 inspect는 현재 관찰 슬롯을 교체하므로 두 결과를 한 exec에서 얻어도 이전 관찰 ID를 계속 입력에 쓸 수 없다. 매크로는 각 단계의 명시적 selector를 새 UIA 관찰에서 찾으며 이전 선택을 추측하지 않는다. 재조회 자체가 아닌 모델 왕복을 줄인다.

기존 image-input/runtime/switched-default 테스트 16/16 통과, exit 0, 터미널 기록 1794750796836621-8328-15436. 전체 공개 입력 스키마가 HEAD와 동일함을 별도 확인했다. 새 영구 테스트나 임시 스크립트는 만들지 않았다. 테스트 소유 fixture 정리를 확인했다. MCP 새로고침 후 실제 context에서 guideVersion 6과 UIA 안내를 확인했다. 전체 ready:false는 기존 laio:false이며 az_window_use는 준비됐다. 내장판·제품 설치·push·새 통합 캡처 API 및 모델 행동 효과 측정은 수행하지 않았다. 기존 진단 변경을 제외한 3개 파일만 검토 후 커밋했다.

## 범위와 결정
사용자가 토큰 효율/마지막 수단 선택 규칙 제거, batch action의 현재성 확인, 구형 입력 필드 부정 문구 정리, 창 점유 안내의 context 일원화를 요청했다. 독립 MCP의 모델용 안내만 바꾸며 내장판, 입력 스키마, 네이티브 실행·점유 정책, 권한과 재실행 금지는 변경하지 않는다. namespace instructions 도입이나 공통 입력 API 재설계는 이번 범위가 아니다.

현재 batch 내부 click/text/press는 action 단계 구분자를 필수로 사용한다. 사용자는 기존 설명으로 충분하다고 지정했으므로 batch 클릭 안내는 원래 문장을 그대로 사용한다. action이 없다는 문장과 구형 x/y/fromX/fromY, move 부정 목록은 삭제한다. 점유 규칙은 context에 1회만 두고 list_windows/도구 뒤 공통 문구를 제거한다. status의 반환 필드 설명은 유지한다. context 안내 버전은 변경된 안내를 다시 받을 수 있도록 올린다.

## 실행과 검증
루트가 기존 소유 파일 src/runtime.cjs, vendor/azrael/window-input-guidance.cjs, window-control-mcp.cjs와 아키텍처의 해당 문장만 변경한다. 기존 의존성과 입력 정규화 코드를 재사용한다. 상세 안내는 계속 기존 도구 설명/context로 제공한다.

공통 모델 문구 변경이며 제품 환경은 로컬 Windows x64 대화형 데스크톱 범위를 유지한다. Windows에서 기존 image-input/runtime/switched-default 검사, 공개 도구 정의와 실제 MCP context 결과로 문구/버전/입력 형식을 확인한다. 입력 스키마가 동일하고 batch click이 현재 형식임을 기존 검사와 정규화로 검증한다. 문구 검사는 모델 행동의 변화나 다른 OS 수용을 증명하지 않는다.

기존 테스트면 충분하며 별도 영구 문구 스냅샷은 추가하지 않는다. 테스트가 관리하는 임시 설정은 기존 정리 경로를 따른다. 제품 빌드·설치와 push는 범위가 아니다. MCP 소스 연결을 새로고침해 실제 안내를 확인한다. 기존 진단 변경은 커밋에서 분리 보존한다.

## 결과

- 커밋 `4dfa0e5bbc0acff855c4ca41cbc5feecf25b6d7f`: 안내 세 소유 파일과 아키텍처 해당 문장만 포함한다. 기존 진단 변경은 보존했다.
- 기존 검사 16/16 통과, exit 0. 터미널 기록 `1794733048094235-8328-7306`. batch 단계의 click/text/press action 필수 형식과 양쪽 입력 정규화도 별도 확인했다.
- 전체 공개 도구 입력 스키마 SHA256 변경 전후 동일: `258063e86c0c1c3781171ad0ad8fff86f0a8a5c610d6a8e1f86d6488df200264`. 별도 검사 exit 0, 터미널 기록 `1794733049523542-8328-7324`.
- 새로고침에서 az_window_use:true. 전체 ready:false는 기존 laio:false 때문이다. 실제 MCP context에서 선택 우선순위 문구 제거와 점유 규칙 1회를 확인했다. batch 설명만 원래 표현으로 복원한 커밋은 `30d6c8c`이다. 기존 안내 파일과 정확히 같은 내용인지 검사했고 양쪽 입력 도구 설명 및 실제 MCP context에서 원래 문장을 확인했다. 현재 guideVersion은 `standalone-window-use-5`다. 다른 정리 내용과 입력 스키마는 유지했다.
- 테스트 소유 임시 하위 디렉터리는 기존 after 정리로 삭제됐고 `artifacts/verification/unit`의 하위 디렉터리가 없음을 확인했다. 별도 스크립트·바이너리·백업은 만들지 않았다. 유지되는 새 작업 계획은 이 문서뿐이다. 제품 빌드/설치, push, 모델 행동 및 타 OS 검증은 실행하지 않았다.

## Independent suppression safety

Scope: standalone MCP, Windows x64 local interactive desktop. Approved: physical Esc consumed during suppression, independent recovery with non-extendable ten-second ceiling. Project-specific macro storage and builtin port excluded. Preserve shorter operation budgets, permissions, Stop and no replay of unknown input.

Reuse SystemCursor guardian process pattern; dedicated input guard installs before suppression, covers UI/broker stalls, requests cooperative cleanup first, then terminates only its inherited exact native-helper handle if gates remain. Shared model-input ledger allows releases only; forced recovery loses the in-memory user buffer and cannot promise original focus. Verify physical/injected Esc distinction, paired edges, overlapping gates, live child-process stall and hard limit.

Generated build owner: standalone-input-safety; planned single disposable root artifacts/input-safety-run (separate from the historically locked artifacts/verification ancestor). Freeze native inputs per attempt; record actual compilation/tests and cleanup through project maintenance.

Verification so far: attempt2/3 native compilation exit0; eight native checks passed, including real independent victim termination on heartbeat loss and ten-second expiry despite continued heartbeat. Existing live keyboard focus/replay fixture exit0. Owned WinForms button click with actual new helper, hook and guardian startup passed with one click, reservation restored, no buffered/pending events. JS 30/30 pass exit0. An initial live probe expected an activation-marker capability absent in its reused fixture; removed that fixture-only assumption, used actual product target activation, and passed.

Review corrected shared Esc latch across hook ordering, natural-parent-exit race during force termination, and conservative tracking of partial packets with repeated Unicode units. Final frozen attempt4 is compiling; previous inputs remain immutable. No physical-device Esc test claimed.

Final checks: native attempt4 compiled exit0 (15.8s), nine native checks exit0; JS 30/30 exit0; final actual helper click plus click/text batch with repeated aaaa passed against owned fixture (text length10), independent guard ready and reservation restored without pending input. Physical Esc classification and shared paired-edge state passed, real physical hardware acceptance remains unverified. Metadata allowlist check passed. Planned retained runtime deliverable: artifacts/local/input-safety-connected, owner standalone-input-safety, consumes unchanged verified window-control from capture-uia-connected and new multi-pointer from frozen attempt4. Temporary run closes after payload/evidence handoff and cleanup.

Final review identified a release-vs-new-physical-input race after helper teardown. Added guardian physical key/button tracking and delivery-time filtering of own injected recovery UP events while the same physical key/button is held; no added ordinary-input suppression or replay. New frozen attempt5 re-verifies changed guard and actual broker integration. The registered disposable group will be reconciled before cleanup because these outputs change its measured content.

Attempt5 native tests all passed, but final whole-snapshot verification detected a documentation edit to native README made after freezing. The payload refresh stopped before copying the v5 binary. Starting immutable attempt6 with final source/docs; the subsequent old-runtime fixture result is not v5 acceptance and will be rerun with final runtime.

Seed guardian held-state snapshot after hooks install and before readiness, matching existing Windows asynchronous-state bootstrap followed by real physical-edge reconciliation. Added retained checks for recovery key-up protection, own-marker separation and consumed emergency Esc release exception. Final attempt7 includes all corrections; no further source/doc edits during its execution.

Committed 7590a7c. Final frozen attempt7: configure/build and nine native checks exit0, actual owned helper click and repeated-text batch exit0. Runtime manifest 3ab2c295d4f4453d5270b14dc50fa8b20324950227a3a8458976f05579905855. Native source fingerprint rechecked against frozen inputs. Updated only external az_window_use runtime path in config.toml to artifacts/local/input-safety-connected/runtime/window-control, reusing exact unchanged window-control receipt 7793c95fa162f72e9a21f0c94554302edad60aa69468d2a56e1ded90d84124a9. Reconnect and disposable-run cleanup next. No builtin port, macro storage change or push.

Input safety task complete: commit 7590a7cee04090fc482227b0904110e0657e726c; independent az_window_use reconnected ready:true and context returned available:true/switchedInput:true. Other unrelated laio remains unavailable. Retained active runtime group input-safety-runtime-7590a7c, 1857266 bytes, with current config reference and independent build evidence. Disposable group input-safety-run-20261115 (73300031 bytes) deleted through project cleanup owner; physical root absence verified. Prior user-approved capture-uia-run retention remains unchanged. Physical-device Esc/IME/remapping and builtin port are not verified/changed.
