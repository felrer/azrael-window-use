# Tauri 호스트

상태: 구현. Windows x64 실제 패키지의 MCP·승인·설정·창 격리·Stop 수용 검사 11개와 macOS arm64 빌드·서명·MCP·Azrael 소비자 검증을 통과했습니다. Mac GUI는 사용자 준비 후 검증하며 Linux 빌드·GUI는 미검증입니다. 전역 단축키 충돌 중 시작은 확인했으며 다른 앱이 단축키를 해제한 뒤 자동 재등록되는 실환경 검사는 남아 있습니다. 공개 v0.1.0 ZIP은 이전 Electron 형식입니다.

## 구조와 보존 계약

0.1.1 소스는 Chromium/Electron을 제거하고 Rust Tauri v2 호스트와 Node MCP 서비스를 사용합니다. 기존 HTML/CSS·승인·설정 렌더러를 유지합니다. Node와 네이티브 입력 엔진을 패키지에 포함하므로 별도 Node 설치는 필요하지 않습니다. Windows x64는 시스템 WebView2, macOS arm64는 WKWebView, Linux x64는 WebKitGTK를 사용합니다. GUI 표시와 OS 입력 지원 범위는 별개이며 기존 플랫폼 차이를 유지합니다.

일반 실행과 MCP 실행은 가벼운 전달 모드입니다. 설치 후보를 등록하고 공용 서비스에 연결합니다. 실제 `--shared-service` 호스트만 Tauri UI·트레이·전역 중지를 소유합니다. 진행 중인 요청과 입력 정리가 끝난 뒤 호환 최신 설치본으로 전환하고 불확실한 입력을 재실행하지 않습니다. MCP·공용 서비스 프로토콜은 1을 유지합니다. Azrael 연결의 승인은 기존 채팅으로 전달하고 일반 MCP 연결은 자체 승인창을 사용합니다.

## 프로세스와 권한

Rust 호스트와 Node worker는 상속한 전용 파이프에서 JSONL로 통신합니다. MCP 모드의 stdout은 MCP 전용입니다. UI는 자신의 창 종류에 허용된 스냅샷·설정·승인 명령만 요청할 수 있습니다. 설정 변경은 설정 창에서, 승인 응답은 승인 창에서만 처리합니다. 프런트엔드에 임의 파일·프로세스 실행 권한은 제공하지 않습니다. 앱 선택과 아이콘 추출은 제한된 네이티브 요청입니다.

스냅샷 이벤트는 Rust의 명시적인 `WebviewWindow` 대상 송신과 브리지의 같은 창 대상 수신을 함께 사용합니다. Tauri v2의 `window.emit()`은 전역 송신이므로 사용하지 않습니다. 승인창과 설정창이 동시에 존재해도 각 창이 자기 상태만 렌더링해야 합니다. 명령의 권한 판단은 프런트엔드가 보낸 창 이름이 아닌 네이티브 호출 창에서 결정합니다.

Node worker 종료나 파이프 단절은 새 권한을 만들지 않습니다. 승인창 닫기는 대기 승인을 거절하고, 설정 창 닫기는 연결을 유지합니다. Stop, 60초 승인 만료, 보호 앱, 연결별 임시 권한과 입력 복원은 기존 서비스가 집행합니다. 입력·커서 백엔드의 안전장치는 UI 프레임워크와 독립적입니다.

다른 앱이 전역 Stop 단축키를 점유하면 시작을 유지하면서 트레이 항목과 툴팁에 사용 불가를 표시합니다. 5초마다 등록을 재시도하고 성공하면 정상 표시로 복구합니다. 그동안 트레이·UI Stop과 네이티브 입력의 Esc·시간 제한은 유지됩니다. 렌더러 오류는 Stop을 요청하고, 조용히 멈춘 렌더러는 30초 heartbeat 제한으로 감지합니다.

## 자원과 무결성

Windows와 Linux의 자원 루트는 실행 파일 옆 `resources/`, macOS는 앱의 `Contents/Resources`입니다.

| 경로 | 내용 |
| --- | --- |
| `app/` | Node 서비스·승인 UI·프로덕션 의존성 |
| `node/node.exe` 또는 `node/node` | 선택한 Node 실행 파일과 라이선스 |
| `runtime/window-control/` | 플랫폼별 네이티브 백엔드 |
| `runtime/multi-pointer/` | Windows 입력 가상화 런타임 |

프로덕션 의존성은 `app/dependencies.sha256.json`의 전체 정확한 목록·해시를 검증한 뒤 로드합니다. 목록 자체, 서비스 소스, Node·호스트 실행 파일, 네이티브 런타임은 설치 후보의 신원에 연결합니다. 개발 실행과 배포 실행의 경로를 구분하고 각 설치본이 자신의 자원 경로를 다시 결정합니다.

배포 보고서는 `runtime:"tauri"`, 명시적인 `payloadDirectory`와 `executable`, 전체 파일·링크 목록, 선택한 Node와 호스트의 해시, 고정 입력 및 네이티브 매니페스트 증거를 기록합니다. Electron의 ASAR 검사로 Tauri 패키지를 판정하지 않습니다. 전체 무결성 통과와 실제 GUI 수용 상태는 별도로 기록합니다.

## 개발과 패키징

`npm ci`와 기존 네이티브 빌드를 먼저 실행합니다. Node와 그 버전에 맞는 라이선스를 명시하여 자원을 준비합니다.

```powershell
node scripts/package.cjs --prepare --node 'C:\Program Files\nodejs\node.exe' --node-license 'C:\Inputs\node-LICENSE'
cargo build --manifest-path src-tauri/Cargo.toml --release --locked
$env:AZ_WINDOW_USE_HOST_EXECUTABLE = (Resolve-Path src-tauri/target/release/azrael-window-use.exe).Path
npm start
```

기본 개발 런처는 `src-tauri/target/debug/azrael-window-use`를 찾습니다. 다른 빌드 경로는 `AZ_WINDOW_USE_HOST_EXECUTABLE`로 명시합니다. 빌드 입력과 준비 영수증을 고정하고 실제 빌드된 실행 파일의 해시·입력 신원을 검증한 `--host-report`를 사용하여 최종 패키징합니다.

```powershell
node scripts/package.cjs --host 'C:\Build\azrael-window-use.exe' --host-report 'C:\Build\host-report.json'
```

Mac은 `scripts/stage-tauri-macos.cjs --prepared <준비 영수증 절대 경로> --host <Rust 바이너리 절대 경로> --host-report <컴파일 영수증 절대 경로> --out <새 작업 폴더 절대 경로>`로 `WindowUseHost.app`을 구성합니다. 도구가 출력한 앱 경로와 보강된 host-report를 최종 패키징에 전달합니다. 복사한 앱에 ad-hoc 서명을 적용하고 원시 바이너리 해시, 서명 후 해시, 생성 아이콘과 원본 자원 신원을 각각 보존합니다. 배포자 서명·공증은 별도 절차입니다.

설치본의 버전이 기존 0.1.0보다 높아야 공용 서비스의 최신 호환 버전 전환 대상이 됩니다. 이 절차는 인터넷 자동 업데이트나 GitHub 게시를 수행하지 않습니다.

## Windows UI 수용 검사

`node scripts/verify-windows.cjs --executable <배포 실행 파일> --ui-only --run-dir <새 작업 폴더>`는 전용 프로필·작업 소유 WinForms fixture로 MCP stdio, 승인 닫기·거부·허용, UIA 편집·실행, 일반 실행의 공용 호스트 재사용, 설정/승인창 격리, 테마와 Stop을 확인합니다. `--ui-only`는 기존 좌표 입력 수용 검사를 생략하며 사용자의 앱을 조작하지 않습니다. 검사 전용 WebView2 CDP와 데이터 경로는 자식 환경에만 설정합니다. 마지막 WebView가 닫힌 후 새 WebView가 생성될 때 CDP 연결을 갱신합니다.

네이티브 제품 빌드·ZIP 생성과 UI/MCP 기한 검사를 동시에 실행하지 않습니다. Windows의 파일 I/O 경합으로 시작 기한이 초과되면 실제 실패를 보존하고 제품 오류 여부를 단독 검사로 구분합니다. 제품의 입력 시간 제한이나 승인 정책을 늘려서 우회하지 않습니다.
