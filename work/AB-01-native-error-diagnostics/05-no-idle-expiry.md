# 입력 없는 초기화 대기의 10초 제한 제거

## 범위

독립 MCP Windows x64 네이티브 초기화에서 물리 상대 마우스 이동을 기다리는 단계의 10초 만료를 제거한다. 입력이 없으면 awaiting_relative_motion 상태를 유지하며 사용자 입력을 가로채지 않는다. 실제 억제 검증을 시작한 뒤의 250ms 제한, 준비 완료 전 모델 입력 제한, 명시적 해제와 Stop은 유지한다.

이 변경은 사용자 움직임 없이 모델이 즉시 조작하도록 만드는 설계 변경이 아니다. 무입력 상태를 시간 경과만으로 오류로 취급하지 않도록 하는 범위다. 설치된 배포 런타임과 전역 MCP 설정은 변경하지 않았다.

## 구현과 검증

대기 만료 시각을 제거하고 tick의 시간 초과를 활성 probe에만 적용한다. 대기 중 probeRemainingMs는 0이며 capability_pending은 true다. 검사 시간을 전달할 수 있도록 tick에 기본값이 있는 시각 인수를 추가했고, 제품 호출은 기존처럼 실제 시각을 사용한다.

전용 네이티브 검사는 제품 tick에 하루 뒤 시각을 전달해 대기가 실패하지 않으며 억제·준비 완료가 잘못 켜지지 않는지 확인한다. 실제 하루 동안 실행한 결과는 아니다. 활성 probe의 시간 초과는 여전히 실패와 억제 해제로 이어지고, 명시적 disable은 대기를 끝내는지 함께 검사한다. 이 검사를 제품 네이티브 빌드 절차에 연결해 시간 제한을 실수로 복구하는 회귀를 막는다.

고정된 네이티브 입력으로 C++ 컴파일과 준비 대기·키보드·Raw Input 출처·커서 가드 검사를 실행한다. 별도로 npm test 17/17, exit 0. JS 구문·diff 검사 exit 0. 최소 빌드 결과는 아래에 기록한다. 새 배포 패키지 설치나 실제 MCP의 동시 조작 검증은 수행하지 않는다.

## 정리

no-idle-run/, no-idle-run-2/, build-no-idle.cjs는 이 작업 소유의 빌드·로그·임시 검사 파일이다. 빌드 및 검사 프로세스 종료 후 최소 결과를 보존하고 일반 삭제와 실제 부재 확인을 완료했다. 기존 게시 런타임과 이전 미커밋 로깅 변경은 유지했다.

```json
{
  "builds": [
    {
      "name": "no-idle-run",
      "owner": "AB-01-no-idle-expiry",
      "sourceSha256": "7b059f0c73e5486611c407c95fe3599137462263ce9736fba1f7cc5ec1219c48",
      "steps": [
        {
          "name": "configure",
          "exitCode": 0,
          "signal": null,
          "elapsedMs": 23946
        },
        {
          "name": "compile",
          "exitCode": 1,
          "signal": null,
          "elapsedMs": 15178
        }
      ],
      "status": "failed",
      "compilerRoot": "C:\\Program Files\\Microsoft Visual Studio\\18\\Community",
      "error": "compile failed"
    },
    {
      "name": "no-idle-run-2",
      "owner": "AB-01-no-idle-expiry",
      "sourceSha256": "a8ebe096c71e3ce969794543558c1f3e8231d58889fe442c26436a46164d2f19",
      "steps": [
        {
          "name": "configure",
          "exitCode": 0,
          "signal": null,
          "elapsedMs": 6910
        },
        {
          "name": "compile",
          "exitCode": 0,
          "signal": null,
          "elapsedMs": 19677
        },
        {
          "name": "preparation-wait",
          "exitCode": 0,
          "signal": null,
          "elapsedMs": 73
        },
        {
          "name": "keyboard",
          "exitCode": 0,
          "signal": null,
          "elapsedMs": 24
        },
        {
          "name": "raw-origin",
          "exitCode": 0,
          "signal": null,
          "elapsedMs": 41
        },
        {
          "name": "cursor",
          "exitCode": 0,
          "signal": null,
          "elapsedMs": 2325
        }
      ],
      "status": "passed",
      "compilerRoot": "C:\\Program Files\\Microsoft Visual Studio\\18\\Community",
      "executableSha256": "ad8819e056bb43eda29c7f748fc9ee958a064fde8cb09d795a8eadb01d2898c1"
    }
  ],
  "unitTests": {
    "passed": 17,
    "exitCode": 0,
    "record": "1794573509556307-49944-29726"
  },
  "nativeRecord": "1794573586964550-49944-29802",
  "firstFailure": "New test used nonexistent snapshot() API; corrected to status(), then rebuilt from a fresh frozen identity."
}
```
