# 독립 Window Use MCP 기능 검증

## 범위

2026-11-13 Windows x64 대화형 데스크톱에서 독립 프로젝트의 개발 런처에 표준 MCP SDK로 연결했다. 기준 소스는 `31ca7bc`이며 이전 작업의 미커밋 진단 로깅 변경이 포함된 실행이다. 설치 패키지와 Azrael 내장 MCP의 수용 결과로 확대하지 않는다. 전역 MCP 설정과 제품 입력 정책은 변경하지 않았다.

사용자가 확정한 기준은 외부 마우스·키보드 이벤트를 기록하면서 가상화 입력의 실제 효과를 검증하는 것이다. 외부 이벤트 때문에 중단된 결과를 정상 동작으로 인정하지 않는다. 명시적 사용자 Stop, 권한, 보호 앱 검사는 유지한다.

## 결과

| 기능 | 실제 결과 |
| --- | --- |
| SDK stdio 연결·25개 도구 발견 | 성공 |
| 승인창 자동 생성·닫기·거부·허용 | 성공, 거부 시 입력 없음 |
| UIA 값 읽기·변경·버튼 실행 | 첫 기본 실행 성공. 후속 실행 중 값 불일치 1회: KeyPress 5회, 길이 24. 외부 입력과 제품 원인의 분리는 미확정 |
| 창 상태·캡처·조건 검색·크기 변경 | 성공 |
| 매크로 목록·인라인 assert 매크로 | 성공 |
| 보호 앱 관찰/제어 차단·데스크톱 마스킹 | 성공 |
| 기본 데스크톱 좌표 클릭 | 첫 실행 실제 클릭 확인. 후속 외부 입력 중 interrupted 발생 |
| 가상화 + 외부 마우스 이동 | 최종 실행 클릭·포커스·텍스트 실제 반영 성공, ready 유지. 각 작업 사이 외부 마우스 이벤트 증가 확인 |
| 가상화 + 외부 키보드 | 실패 재현. 클릭 효과는 발생했으나 collaboration_failed 및 physical_keyboard_fail_open 반환, enabled=false/phase=failed |
| Stop·명시적 재개·입력 해제·EOF 종료 | 기본/추가 실행 성공 |

## 오류 목록과 원인

1. **가상화 중 외부 키보드 입력이 모델 입력을 중단한다.** `native/multi-pointer/overlay.hpp`의 `keyboardHook`은 자체 태그가 아닌 키보드 이벤트에 대해 capture/probe 상태에서 `routing.fail(physicalKeyboard)`를 호출한다. 진단도 `physicalKeyboard=fail_open_and_stop_model`을 선언한다. 가상화가 독립적으로 유지되어야 한다는 사용자 요구와 현재 구현이 다르다. `virtual-run-3`에서 클릭은 실제 발생했지만 도구는 실패를 반환했다. 불확실한 입력은 재전송하지 않았다.
2. **입력 오류 후 가상화 상태가 사라진다.** `window-control-policy.cjs`의 switched_input 예외 경로가 pause 후 releaseSwitched를 호출한다. 후속 입력에서 requested=false/phase=off를 관측했다. 새 검증기는 다음 독립 작업 전에 가상화 설정을 복구하고 일반 입력으로 조용히 대체하지 않는다.
3. **가상화 초기화가 물리 상대 마우스 이동을 기다린다.** awaiting_relative_motion/capability_pending 상태에서 클릭이 거절됐다. 최종 검증기는 bounded status 대기를 추가했으며, 키보드만 사용하는 환경의 준비 완료는 입증되지 않았다.
4. **미지원 UIA 필드가 미분류 오류가 된다.** 버튼의 value 필드를 읽으면 unclassified/native-error, HRESULT 0x00000000. 입력은 실행되지 않는다. `native/window-control/src/uia.rs`의 unsupported 변환은 UIA_E_NOTSUPPORTED만 별도 분류한다. 원래 발생한 Windows API별 원인은 이 진단만으로 확정하지 않는다.

## 검증기 변경과 판정

`node scripts/verify-windows.cjs --virtualization`은 가상화 설정, 준비 상태, 이벤트 증분, 도구 결과와 실제 앱 효과를 각각 기록한다. 이벤트 감지나 개별 작업 실패 뒤에도 후속 검사를 진행한다. 불확실한 입력을 재실행하지 않는다. 클릭·텍스트가 성공해도 가상화가 꺼졌거나 외부 마우스/키보드 검증이 빠지면 전체 동시 사용 통과로 판정하지 않는다.

기본 실검증 11항목 exit 0. 최종 가상화 실검증은 마우스 동시 사용 효과가 모두 성공했으나 키보드 이벤트가 없는 실행이므로 exit 1, `incomplete_external_input_coverage`다. 앞선 별도 실행에서 외부 키보드로 인한 실패는 재현했다. 검증기 단위 테스트 4개를 포함한 npm test는 11/11, exit 0. JS 구문 검사와 diff 검사는 exit 0. 최소 실행 증거는 functional-evidence.json에 보존했다.

지원 요소를 가진 toggle/select/expand/collapse/scroll, 창 복원, 크기 매크로, 매크로 저장, 배포 패키지와 Azrael 앱의 지속 MCP 등록은 검증하지 않았다. 이번 연결은 테스트 수명 동안만 유지했다.

## 정리

모든 실행의 EOF/실패 finally와 실제 프로세스 종료를 확인한 뒤 작업 소유 테스트 앱·프로필·스크린샷·원시 응답·임시 probe 및 이번에 생성한 개발 런처를 삭제했고 실제 부재를 확인했다. 유지 대상은 계획, 이 보고서, 최소 증거와 요청한 검증기 소스다. 이전 미커밋 로깅 작업은 보존한다.
