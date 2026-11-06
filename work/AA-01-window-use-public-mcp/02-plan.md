상태: MCP 승인 UI 보완·정확한 패키지 수용 검증·Azrael 경로 갱신·이번 임시 자료 정리 완료. 기존 별도 테스트 세션의 Azrael 자체 승인 대기는 이 MCP 검증과 구분한다.

# Azrael 등록과 테스트 세션 전달

- 허용된 작업: 현재 배포본을 Azrael 사용자 설정에 추가하고, 새 세션을 만들어 작업 맥락과 실사용 테스트 요청을 전송한다. 기존 내장 MCP, 모델 기본값, 앱 승인 정책, 다른 세션은 변경하지 않는다.
- 플랫폼: 현재 로컬 Windows x64 Azrael 창과 .azrael-ex 사용자 상태만 대상으로 한다. 새 MCP는 window_use_public, cwd는 이 독립 프로젝트다.
- Azrael 공식 stdio API를 현재 상속된 AZRAEL_EX_WINDOW_CONTEXT로 연결한다. 읽기 전용 관리 bridge의 허용 목록이나 Windows UI 제어 정책을 우회하지 않는다.
- 순서: config/read로 버전과 기존 등록 확인 → config/value/write로 단일 서버 추가 → 설정 재조회 → thread/start 및 이름 지정 → 해당 스레드의 MCP 연결/도구 확인 → turn/start로 한국어 맥락·테스트 요청 전달 → 새 세션에서 요청이 접수되었는지 확인.
- 설정은 실제 WindowUseMCP.exe와 --mcp를 사용한다. 자체 서버 기본 승인 모드와 보호 앱을 유지하며 모델이 승인 UI를 조작하도록 요청하지 않는다.
- 새 세션은 실사용 관찰·검증과 결과 보고만 요청한다. 수정·공개 업로드는 추가 승인 대상이며, 실제 입력 전 사용자에게 알리고 실패/불확실 입력을 재실행하지 않도록 안내한다.
- 검증: 등록의 정확한 명령/인수, MCP connected 상태와 모델용 도구 24개(앱 전용 1개를 포함한 원시 카탈로그 25개), 실제 새 thread/turn ID 및 저장된 사용자 요청. 테스트 완료까지 기다리는 것은 이번 전달 작업의 범위가 아니다.
- 결과와 최소 수신 증거를 이 작업 폴더에 보존하고 일회성 제어 스크립트/로그는 소유자 절차로 정리한다. 기존 127,317,506바이트 보관 예외는 그대로 유지한다.

## 실행 결과

- 버전 검사와 공식 config/value/write로 C:/Users/felre/.azrael-ex/config.toml의 mcp_servers.window_use_public을 추가했다. 명령은 고정 배포 실행 파일, 인수 --mcp, startup_timeout_sec=20, tool_timeout_sec=120이다. 설정 API 재조회와 독립 TOML 파싱으로 확인했고 기존 MCP 설정은 의미상 동일하다. 전역 모델/권한은 변경하지 않았다.
- 새 스레드: 01a1af68-14af-74b0-aa45-99112869ebc1, 제목 “독립 Window Use MCP 실사용 테스트”, cwd는 이 프로젝트. URI 열기 요청도 OS에 전달했다.
- 해당 스레드에서 실제 MCP connected, 카탈로그 25개 중 모델용 24개를 확인했다. 처음 확인 스크립트의 전체 개수 예상이 24여서 메시지 전송 전에 멈췄지만, 원본 정의의 앱 전용 ui_operation을 확인하고 같은 스레드를 재사용했다.
- 요청은 test-request.md의 전체 내용을 turn/start로 한 번 전송했다. turn ID는 01a1af69-0e52-76c1-8a1f-f08160a68759이며 별도 thread/read로 사용자 메시지 저장을 확인했다. 제어 프록시 종료 후에도 이 스레드와 요청 이력을 확인했다.
- 첫 모델 실행은 실제 failed였다: ChatGPT 계정에서 gpt-6.1-sol 미지원(model_not_found/HTTP400). 도구 실행 이전이며 MCP 오류로 보고하지 않는다. 현재 원래 대화의 모델 조회는 별도 workspace 경계로 거부되어 우회하지 않았다.
- 이 스레드 범위의 model/list는 GPT-6-Luna를 기본값으로 표시한다. 사용자가 “새 세션만 GPT-6-Luna로 재개”를 명시적으로 승인했다. 전역 설정을 유지하며 같은 스레드의 모델만 변경해 원래 테스트 요청을 이어간다. 제어 출력은 artifacts/azrael-luna-resume-*의 독립 실행 그룹으로 관리한다.
- 최소 증거는 azrael-handoff-receipt.json, 전달한 본문은 test-request.md에 보존한다. Azrael 설정이 참조하는 최종 release 폴더는 활성 소비자 참조로 보호한다.
- 연결·전송·재조회에 쓴 일회성 제어 스크립트/로그 15,898 bytes는 azrael-client-handoff-01 소유자 그룹으로 검토·삭제했고 remaining=false를 확인했다. 기존 보관 예외 자료는 변경하지 않았다.
- 사용자 승인을 받아 같은 스레드만 GPT-6-Luna(openai)로 재개했다. 전역 model은 전후 모두 gpt-6.1-sol로 동일하며 계정·제공자·권한 기본값은 변경하지 않았다. 새 turn ID는 01a1af74-3c8f-7e82-9295-c0d4ed2e66a2이고 원래 맥락을 이어받는 테스트 요청의 저장을 확인했다.
- 실제 agentMessage 생성, turn inProgress, error=null을 확인해 이전 모델 거절을 벗어났음을 확인했다. 제어 프록시를 종료한 뒤에도 active/waitingOnApproval이었다. 승인은 사용자/기존 UI 소유자가 처리해야 하며 root가 응답하거나 우회하지 않았다. 새 테스트의 도구 실행/성공 판정은 아직 하지 않았다.
- 모델 재개/확인용 일회성 자료 8,784 bytes도 azrael-luna-resume-01 그룹으로 삭제했고 remaining=false를 확인했다. 실행 중인 테스트 세션과 MCP 배포 파일은 정리 대상에 포함하지 않았다.

## MCP 승인창 수명주기 보완 — 완료

- 사용자 요청: MCP가 실행될 때 UI를 따로 열어두지 않아도 권한 요청 시 창을 실행하고, 닫은 창도 다시 생성한다. 기존 승인 정책·보호 앱·사용자 중지는 유지한다. Azrael 원본의 UI 자동 실행 기능 추가는 이번 변경 범위에 포함하지 않는다.
- Windows x64 로컬 대화형 데스크톱 대상. MCP console launcher가 Electron host를 자동 시작하는 기존 경로를 재사용한다. 별도 IPC 서버·신규 의존성·상주 자동 시작 등록은 필요하지 않다.
- 변경: 닫기는 renderer를 해제하고 host/tray/MCP는 유지한다. 다음 권한 요청은 새 승인창을 생성한다. 닫힌 승인 요청은 거절하며 만료/취소된 요청의 늦은 표시를 막는다. 로그에 창 생성/표시/종료 메타데이터를 기록한다.
- 검증: 기존 실제 stdio/fixture 수용 검증에 UI 사전 실행 없음, 대기 승인창 닫기=거절, 창 0개 상태에서 재요청=새 창, 설정창 닫기 후 재생성을 추가한다. 향후 main-process close/show 수정 시 renderer 재사용만 검사하고 실제 종료를 누락할 수 있으므로 기존 수용 검사 안에 유지한다. PermissionService/runtime/native는 변경하지 않아 이전 단위/native 결과를 재사용한다.
- 준비 순서: main/수용 검사/문서 확정 → syntax 검사 → 고유 불변 portable 빌드 → 그 정확한 패키지 실제 UI 수용 → Azrael 설정의 executable 경로 갱신 → 기능 단위 commit. 현재 연결된 구 패키지는 활성 소비자 종료 전 삭제하지 않는다.
- 산출물 소유자: standalone-package가 새 artifacts/build/package-<buildId>, artifacts/logs/package-<buildId>, artifacts/releases/0.1.0-<buildId>를 자체 package-report에 실행 전에 기록한다. 이번 검증 소유자는 window-use-public-mcp, 임시 run은 artifacts/ui-demand-20261106-01 (profile/fixture/result 포함); 완료 후 최소 증거만 이 work에 보존하고 owner review/apply로 삭제한다. 기존 artifacts/verification 및 artifacts/acceptance 부모 등록과 겹치지 않는 새 경계를 사용한다. 이전 승인된 127,317,506 byte 보관 예외는 그대로 유지한다.
- 첫 빌드 run-27480-50-1793948741651229300은 실행 도구의 10초 제한으로 exit 124 (failed, producer_completed=true)에서 종료됐다. 내부 compile-launcher/production-dependencies 단계는 각각 exit0이며 완성 패키지 증거로 사용하지 않는다. package-report는 종료 전 running 상태를 유지하므로 이 별도 기록이 중단 사실을 보완한다. 실행 receipt의 종료 확인과 전체 프로세스 조회에서 package script/해당 snapshot/고유 run을 사용하는 자식 실행 없음, npm 단계 exit0, 외부 zip 단계 미진입을 확인했다. pid35716의 package.lock은 종료된 실행의 잔재다. 락 우회 없이 이 중단 실행의 산출물·비점유 lock을 같은 소유자 정리 도구로 제거한 뒤 새 실행을 시작한다.
- 결과: 새 빌드 20261106T070756738-295b2046c3-ec4566, packaging exit0, 실제 패키지 Windows 수용 11 checks/exit0. 사전 UI 0개, 승인창 실제 닫기와 재생성, 거절 시 입력 없음, 승인 후 실제 UIA 입력, 설정 재생성/테마 보존, 자기 보호/마스킹/물리 입력/Stop/EOF를 확인했다. 승인창 렌더링도 직접 확인했다. 불변 build-info의 초기 acceptance=pending은 수정하지 않고 ui-demand-verification.json이 독립 수용 결과를 소유한다.
- Azrael: 공식 버전 검사 config/value/write로 window_use_public.command만 검증된 새 패키지로 변경하고 API 재독과 별도 TOML 파싱으로 확인했다. 기존 연결은 중단하지 않았으며 새 MCP 연결부터 적용된다. Azrael 클라이언트의 사전 도구 승인은 MCP 호출 전 단계이므로 이번 변경으로 자동 해결됐다고 주장하지 않는다.
- 정리: 중단 실행/비점유 잠금 및 성공 staging/log/검증 프로필 총 79,322,830 logical bytes를 owner review/apply로 삭제하고 모든 remaining=false를 확인했다. 일회용 portable 빌드 bundle은 실행 도구 제한 진단 후 제거했다. 새 배포물은 현재 설정/공개용 산출물 소비자로 보호하고, 구 배포물은 실제 활성 연결 때문에 보존하며 마지막 소비자 종료 후 검토한다. 이전 127,317,506 byte 승인 보관 예외에는 변경이 없다.
