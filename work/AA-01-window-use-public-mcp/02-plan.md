상태: MCP 등록·새 세션 생성·요청 저장 확인 완료. 첫 모델 실행 실패로, 새 세션만 다른 모델로 재개할지 사용자 선택 대기.

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
- 이 스레드 범위의 model/list는 GPT-6-Luna를 기본값으로 표시한다. 전역값을 유지하고 새 세션만 이 모델로 재개할지 사용자에게 질문했다. 아직 답변을 실행 권한으로 간주하지 않는다.
- 최소 증거는 azrael-handoff-receipt.json, 전달한 본문은 test-request.md에 보존한다. Azrael 설정이 참조하는 최종 release 폴더는 활성 소비자 참조로 보호한다.
- 연결·전송·재조회에 쓴 일회성 제어 스크립트/로그 15,898 bytes는 azrael-client-handoff-01 소유자 그룹으로 검토·삭제했고 remaining=false를 확인했다. 기존 보관 예외 자료는 변경하지 않았다.
