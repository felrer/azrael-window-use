# 가상화 마우스 중 물리 키보드 입력

## 요청과 변경 범위

사용자 요청에 따라 가상화 마우스 작업 중 사용자 물리 키보드 입력 때문에 중단하지 않도록 변경했다. Windows x64 독립 MCP에만 적용한다. 모델 자체의 키보드·텍스트 작업, 외부 주입 입력, 명시적 Stop, 연결 종료와 대상 검사는 기존 중단 처리를 유지한다. 입력 재전송은 추가하지 않았다.

네이티브 훅은 물리 키보드 이벤트를 계속 세고 키 상태를 갱신하지만 마우스 협업 실패나 중단 epoch를 발생시키지 않는다. 모델 키보드 작업은 RAII 범위로 표시해 기존 충돌 처리를 유지한다. 마우스 작업의 수정키 감지 게이트도 구분했다. Windows가 수정키 상태를 공유하므로 사용자의 Ctrl/Shift 등이 클릭 의미에 미치는 영향까지 분리하지는 않는다.

## 검증

- 선택한 네이티브 입력을 고정한 C++ 빌드 2회, 각각 exit 0. 첫 빌드 후 Windows 키도 수정키 게이트에서 구분하도록 보완해 새 고정 입력으로 재빌드했다. 실행 중 빌드 입력은 변경하지 않았다.
- 최종 네이티브 키보드 검사, Raw Input 출처 검사, 커서 가드 검사 모두 exit 0. 일반 입력 중단, 가상화 마우스 중 비중단·계수·키 해제, 모델 키보드 충돌, 외부 주입과 중지 상태 보존을 검사한다.
- npm test 17/17, exit 0. JS 구문 및 diff 검사 exit 0.
- 수정한 런타임으로 실제 독립 MCP SDK 연결 성공. 물리 마우스 이동이 없어서 준비 단계가 raw-survival 시간 초과됐고, 클릭·드래그는 실행되지 않았다. 실제 동시 사용 통과로 인정하지 않는다. 외부 이벤트 계수도 0이었다.

변경된 C++만 빌드하고 검증된 기존 window-control 바이너리를 재사용했다. 기존 배포 런타임을 덮어쓰지 않기 위해 개발 실행과 검증기에 절대 경로 `--runtime-directory` 선택을 추가했다. 패키지 실행에서는 이 옵션을 거절한다. 제품 패키지 생성·설치·전역 MCP 설정 변경은 수행하지 않았다. 따라서 설치된 실행본의 동작은 아직 바뀌지 않았다.

## 정리와 근거

작업 프로세스 종료를 확인한 뒤 keyboard-run/, keyboard-run-2/, keyboard-live/, build-keyboard.cjs와 이번에 생성한 dev-launcher를 일반 삭제하고 실제 부재를 확인했다. 이전 게시 런타임과 이전 미커밋 로깅 작업은 보존했다. 아래 최소 근거를 유지한다.

```json
{
  "builds": [
    {
      "name": "keyboard-run",
      "status": "passed",
      "sourceSha256": "37d11d13c8674663d6abe2fc307d7403c775e5b3acf1ae02e4a99b2311be77d4",
      "steps": [
        {
          "name": "configure",
          "exitCode": 0,
          "elapsedMs": 13108
        },
        {
          "name": "compile",
          "exitCode": 0,
          "elapsedMs": 27001
        },
        {
          "name": "keyboard-selftest",
          "exitCode": 0,
          "elapsedMs": 78
        },
        {
          "name": "raw-selftest",
          "exitCode": 0,
          "elapsedMs": 46
        },
        {
          "name": "cursor-selftest",
          "exitCode": 0,
          "elapsedMs": 2314
        }
      ],
      "runtimeManifestSha256": "fb4bebb8a4e5399415eb45a25da492761d41c6605c92b4d41b413d649b7741bd"
    },
    {
      "name": "keyboard-run-2",
      "status": "passed",
      "sourceSha256": "2ee9853d833f6b975785cf7d54eddb62657b4b366839fbe80890968b051cb87d",
      "steps": [
        {
          "name": "configure",
          "exitCode": 0,
          "elapsedMs": 22521
        },
        {
          "name": "compile",
          "exitCode": 0,
          "elapsedMs": 28204
        },
        {
          "name": "keyboard-selftest",
          "exitCode": 0,
          "elapsedMs": 69
        },
        {
          "name": "raw-selftest",
          "exitCode": 0,
          "elapsedMs": 43
        },
        {
          "name": "cursor-selftest",
          "exitCode": 0,
          "elapsedMs": 2349
        }
      ],
      "runtimeManifestSha256": "c27531d47c2c95f0f99e92c21f6c007b8dec056af554a0cb43fba46c48f469db"
    }
  ],
  "nativeRecord": "1794572316329205-49944-27417",
  "unitTests": {
    "passed": 17,
    "exitCode": 0,
    "record": "1794572419579171-49944-27471"
  },
  "live": {
    "exitCode": 1,
    "record": "1794572409390395-49944-27468",
    "cases": [
      {
        "label": "permission and default virtualization",
        "isError": false
      },
      {
        "label": "fixture activation"
      },
      {
        "label": "virtualization status",
        "isError": false,
        "phase": "awaiting_relative_motion",
        "lastFailure": "none",
        "externalEventDelta": null
      },
      {
        "label": "virtualization readiness 1",
        "isError": false,
        "phase": "awaiting_relative_motion",
        "lastFailure": "none",
        "externalEventDelta": {
          "mouse": 0,
          "keyboard": 0
        }
      },
      {
        "label": "virtualization readiness 2",
        "isError": false,
        "phase": "awaiting_relative_motion",
        "lastFailure": "none",
        "externalEventDelta": {
          "mouse": 0,
          "keyboard": 0
        }
      },
      {
        "label": "virtualization readiness 3",
        "isError": false,
        "phase": "failed",
        "lastFailure": "raw_survival_unproven",
        "externalEventDelta": {
          "mouse": 0,
          "keyboard": 0
        }
      },
      {
        "label": "virtualized button click",
        "isError": true,
        "postcondition": false,
        "code": "state_changed",
        "nativeCode": "collaboration_failed",
        "phase": "failed",
        "lastFailure": "raw_survival_unproven",
        "externalEventDelta": {
          "mouse": 0,
          "keyboard": 0
        }
      },
      {
        "label": "virtualized keyboard-concurrent drag",
        "isError": true,
        "postcondition": false,
        "code": "state_changed",
        "nativeCode": "capability_pending",
        "phase": "awaiting_relative_motion",
        "lastFailure": "none",
        "externalEventDelta": {
          "mouse": 0,
          "keyboard": 0
        }
      },
      {
        "label": "virtualization final status",
        "isError": false,
        "phase": "awaiting_relative_motion",
        "lastFailure": "none",
        "externalEventDelta": {
          "mouse": 0,
          "keyboard": 0
        }
      },
      {
        "label": "release virtualized input",
        "isError": false
      }
    ]
  }
}
```
