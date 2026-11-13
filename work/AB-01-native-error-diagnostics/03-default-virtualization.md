# Default virtualization

사용자 요청에 따라 독립 MCP의 실제 입력 세션은 기본으로 가상화 활성화를 요청한다. 오류·해제 후 새 세션에도 적용하며, 명시적 해제는 해당 세션 동안 유지한다. 시각화만 하는 세션은 입력 가로채기를 켜지 않는다. 권한·취소 검사를 유지하고 초기화 실패 시 일반 입력으로 대체하지 않는다.

검증기는 별도 활성화 명령 없이 기본 상태를 확인한다. Windows x64 소스 런처와 표준 SDK 연결에서 requested=true, 이어 ready/enabled=true 및 클릭·텍스트 실제 반영을 확인했다. 실행 exit 0, EOF 종료 확인. 외부 마우스 이벤트가 발생했으며 키보드 이벤트 1개는 준비 중 관측됐다. 동작 중 키보드 독립성이 해결됐다는 증거는 아니다. 기존 physical_keyboard_fail_open 제한은 남아 있다.

단위 테스트 16/16, exit 0. 첫 입력·대체 세션·권한 철회·명시적 해제·시각화·초기화 실패를 검사했다. 실제 실행 기록 1794571824739782-49944-26345, 단위 테스트 기록 1794571861481407-49944-26371. 제품 패키지 생성·설치·전역 MCP 설정 변경은 수행하지 않았다. 이전 진단 로깅 변경은 별도 미커밋 상태로 보존했다.

정리 소유 범위: default-run/ 프로필·픽스처·원시 로그, 이번에 생성한 artifacts/build/dev-launcher. EOF 및 작업 프로세스 부재를 확인한 뒤 일반 삭제하고 실제 부재를 확인했다. 단위 테스트의 고유 default-mode-* 임시 디렉터리도 각 테스트 종료 시 제거·부재 확인했다. 최종 소스의 npm test 재실행도 16/16, exit 0 (1794571981990344-49944-26470).

```json
{
  "result": {
    "platform": "win32",
    "arch": "x64",
    "checks": [
      {
        "name": "standard SDK stdio connection and tool discovery"
      }
    ],
    "virtualization": {
      "passed": true,
      "verdict": "passed",
      "effectsPassed": true,
      "enabled": true,
      "externalObserved": true,
      "externalMouseObserved": true,
      "externalKeyboardObserved": true
    },
    "exitCode": 0
  },
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
      "collaboration": {
        "requested": true,
        "enabled": false,
        "phase": "awaiting_relative_motion"
      },
      "externalEventDelta": null
    },
    {
      "label": "virtualization readiness 1",
      "isError": false,
      "collaboration": {
        "requested": true,
        "enabled": true,
        "phase": "ready"
      },
      "externalEventDelta": {
        "mouse": 207,
        "keyboard": 1
      }
    },
    {
      "label": "virtualized button click",
      "isError": false,
      "postcondition": true,
      "collaboration": {
        "requested": true,
        "enabled": true,
        "phase": "ready"
      },
      "externalEventDelta": {
        "mouse": 407,
        "keyboard": 0
      }
    },
    {
      "label": "virtualized edit focus",
      "isError": false,
      "collaboration": {
        "requested": true,
        "enabled": true,
        "phase": "ready"
      },
      "externalEventDelta": {
        "mouse": 435,
        "keyboard": 0
      }
    },
    {
      "label": "virtualized text",
      "isError": false,
      "postcondition": true,
      "collaboration": {
        "requested": true,
        "enabled": true,
        "phase": "ready"
      },
      "externalEventDelta": {
        "mouse": 88,
        "keyboard": 0
      }
    },
    {
      "label": "virtualization final status",
      "isError": false,
      "collaboration": {
        "requested": true,
        "enabled": true,
        "phase": "ready"
      },
      "externalEventDelta": {
        "mouse": 365,
        "keyboard": 0
      }
    },
    {
      "label": "release virtualized input",
      "isError": false
    }
  ]
}
```
