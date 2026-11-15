상태: 완료 · 승인된 아이콘과 반경1.2 Agent 커서를 독립 MCP에 적용·재연결했고 검증 및 임시 자료 삭제를 마쳤습니다.

# Agent 로고 배치 조정

## 2026-11-16 GitHub 레포 이미지 맞춤

- 승인: 레포 이미지와 앱 이미지 일치. 이름 변경은 가능 여부 질문이므로
  실제 rename은 사용자 확인 후 진행합니다. 권장 URL 이름은 azrael-window-use.
- 확인: GitHub felrer/azrael-window-use-mcp는 private, viewerPermission ADMIN,
  custom social preview 없음. GitHub 공식 문서는 첫 이미지 업로드를 public
  레포 또는 이미 업로드한 이력이 있는 private 레포에 한정합니다. 실제
  설정 화면에도 Social preview 항목이 없습니다. 공개 범위는 변경하지 않습니다.
  https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview
- README에 앱 PNG256을 그대로 참조하는96px 로고를 추가합니다. 새 복제 이미지나
  런타임 변경 없이 기존 src/assets/app-icon-256.png를 사용합니다.
- 현재 원격 master는2789752이고 로컬에는 미게시 기능 커밋16개가 있습니다.
  README/아이콘 두 파일만 원격 parent에서 만든 전용 commit으로 게시하고,
  그 결과를 로컬에 merge하여 다른 기능을 이번 이미지 요청으로 게시하지 않습니다.
  불필요한 작업 복제/검증 프로필/임시 파일은 생성하지 않습니다.

## 2026-11-16 실제 적용 후속 승인

- 사진의 앞 중심 (118,146), 높이139, 뒤 중심 (170,103), 상대크기100%,
  불투명도50%, 전체100%, 어두운 둥근 타일을 채택합니다. 뒤 중심은 앞서
  확인한 배치를 유지합니다. 브라우저의 개인 저장값을 덮어쓰지 않습니다.
- Windows x64 독립 MCP의 트레이·창·launcher/packaged host 아이콘 및
  모든 Agent 색상/상태가 공유하는 네이티브 modelBody를 교체합니다.
  Azrael 본체의 별도 내장 런타임 빌드/설치는 범위에 포함하지 않습니다.
- 원호/외곽선 경계의 패임을 재현 비교하고, 접선이 연속인 단일 cubic
  경로를 SVG와 GDI+가 공유하도록 생성합니다. 원래 다리 각도는 유지합니다.
- 재사용: 네이티브 GDI+ renderer, 기존 CMake, Electron nativeImage/packager,
  .NET /win32icon, 설치된 Chrome/Playwright. 새 라이브러리를 추가하지 않습니다.
- JS 자산/회귀 검사, 크기별 아이콘·확대 연결부의 실제 렌더 확인,
  frozen C++ build/render selftest 후 새 독립 런타임을 연결합니다.
- 임시 build/profile/log는 artifacts/agent-icon-run-20261116 소유로 생성하고
  검증 후 owner 도구로 삭제합니다. 새 연결 runtime과 최소 검증 근거는
  artifacts/local/agent-icon-connected에 유지합니다. 기존 변경은 보존합니다.

### 실제 적용 검증

- 반경1.2, 원래 다리 각도, 45도 이하 cubic 43점이 SVG/native에서 동일합니다.
  접선 연속성과 원호 중심거리 수치 검사를 통과했습니다. 실제 PNG 확대 및
  작은 아이콘을 확인했고 상단 보라색 경계 240행에서 역방향 패임0입니다.
  HTML 원호를 cubic 단일 경로로 교체해 연결부 렌더 결함을 회피했습니다.
- frozen C++ configure/compile exit0; render86검증, curve/cursor-guard/
  autonomous-startup/keyboard-reservation/batch 모두 exit0. 입력전송0,
  foreground/cursor 위치 불변, light/dark 실제 painter 이미지 확인.
- 실제 Electron main을 격리 프로필로 시작해 ICO/PNG nativeImage 비어있지 않음,
  제목표시줄 PNG32 로드와 실제 창을 확인했습니다. 검증용 앱은 종료했습니다.
- HTML 검사 초회 실패는 닫힌 details의 innerText가 빈 값이어서 생긴
  테스트 문제였고 textContent로 고쳐 재검증했습니다. Electron 초회 테스트는
  evaluate 안 require가 없어서 실패했으며 경로를 인자로 전달해 통과했습니다.
- 새 런타임은 기존 검증된 window-control을 그대로 재사용하며 변경된 C++만
  컴파일했습니다. 컴파일 이후 README/저작권 고지만 갱신했으며 코드 동일성을
  검증했습니다. 전체 배포 ZIP/클린 머신과 Azrael 본체 내장 설치는 미검증입니다.
- 최종 JS34개 pass/0 fail/exit0. 실제 launcher에서32px 새 아이콘을 추출해
  확인했습니다. 적용 커밋 `ad1cb68`, active runtime
  artifacts/local/agent-icon-connected 및 content-addressed dev launcher를
  agent-icon-runtime-ad1cb68 그룹으로 등록했습니다. 최소 검증은 해당 버전의
  build-evidence.json/cursor-frames.png에 유지합니다.
- config.toml의 독립 MCP runtime 인자만 교체해 az_window_use 재연결 ready:true,
  context available:true를 확인했습니다. 전체 reload ready:false는 기존 laio
  연결 실패입니다. 다른 세션의 이전 런타임 프로세스는 임의 종료하지 않았습니다.
- 임시 그룹 agent-icon-run-20261116, 42,794,904 logical bytes를 소유 도구로
  삭제했습니다. decision c6c39514181a2eac5b1a4fb4cf0fb99f1b62934336a6de4c1c4dad9073e1da20,
  remaining:false/error:null 및 실제 경로 부재를 확인했습니다.

- 승인: 1번 배치, 보라색 앞 커서와 반투명 민트 뒤 커서. 자리·크기의
  근접 후보 비교, 슬라이더 미세 조정, 실제 16/24/32px 및 밝고 어두운 배경,
  타일/투명 배경 전환. 초기 HTML 단계 이후 위 후속 승인으로 실제 아이콘까지 적용했습니다.
- 결과물: docs/visualizations/agent-logo-lab.html. 네트워크·새 의존성 없이
  네이티브 modelBody 좌표와 0.9 source unit 테두리를 재사용합니다.
- SVG와 PNG 저장, 설정 복사 및 로컬 브라우저 설정 보존을 제공합니다.
- 검증: 벡터 좌표 일치, 오프라인 렌더, 좁은 폭 레이아웃, 조절·후보 선택·리셋,
  SVG/PNG 내려받기를 기존 Playwright로 확인합니다. Python 명령이 없어
  스킬 기본 렌더러를 바로 실행할 수 없는 환경을 확인했으며 로컬 대체
  렌더 경로를 조사합니다.
- 일회성 검증 산출물은 artifacts/logo-lab-run-20261116 아래 현재 작업 소유로
  생성하고 검증 후 삭제합니다. HTML·작업 기록만 유지하고 커밋합니다.
- 다른 작업의 기존 수정과 산출물은 보존합니다. Windows 로컬 Chromium 검증이며,
  결과물 자체는 표준 SVG/HTML 브라우저 문서입니다.

## 검증 결과

- 네이티브 modelBody 25개 점의 모든 좌표가 SVG 경로와 정확히 일치합니다.
  앞 보라색, 뒤 그룹 불투명도 32%, 각 비교 모드의 후보 9개를 확인했습니다.
- 숫자 입력·키보드 방향키·후보 선택·새로고침 후 값 보존·리셋을 통과했습니다.
  투명 배경 SVG의 MIT 고지와 타일 미포함, PNG의 실제 256×256 크기를 확인했습니다.
- 로컬 파일 URL에서 네트워크를 차단한 Playwright 검사 exit 0, JS 오류 0,
  네트워크 요청 0. 320px 폭에서 문서 가로 넘침이 없고 밝고 어두운 테마를
  실제 렌더링해 확인했습니다. 확대/후보 SVG의 종횡비와 좁은 화면 잘림을 수정했습니다.
- Python/py/python3가 없고 기본 Playwright 브라우저 캐시 버전도 맞지 않아,
  새 설치 없이 기존 Chrome 실행 파일을 Playwright로 구동했습니다.
  별도 테스트 프로필·다운로드·스크린샷은 모두 작업 소유 run 내부에 두었습니다.
- 디자인만 변경하므로 기존 MCP 입력 회귀 검사와 네이티브 재빌드는 수행하지 않았습니다.
  앱·트레이 아이콘과 실행 중인 MCP에는 변경이 없습니다.
- 임시 검증 그룹 logo-lab-run-20261116, 344,945 logical bytes를 소유 도구로
  삭제했고 remaining:false 및 실제 경로 부재를 확인했습니다. 별도 보관 자료는 없습니다.

## 전체 가로 이동 후속 변경

- 두 커서의 간격·크기·색·불투명도를 유지하며 함께 좌우로 이동하는
  offsetX 옵션(-48..48, 256px 기준)을 추가합니다. 확대 비율과 무관하게
  이동량을 적용하며 타일 배경은 고정합니다.
- 기존 저장값에는 offsetX:0을 보완하며 다른 조정값은 유지합니다.
  미리보기·후보·작은 아이콘·설정 복사·SVG/PNG와 경계 경고에 동일 적용합니다.
- 검증 산출물은 artifacts/logo-offset-run-20261116 아래 현재 작업 소유입니다.
  기존 설정 마이그레이션, 두 커서 동일 이동, 배경 고정, 재시작 보존과
  SVG 내보내기를 확인한 뒤 임시 브라우저·이미지를 정리합니다.
- 후속 검증 exit 0: 스크린샷의 기존 40/-39/135/95/50/100 값을 보존하고,
  두 커서가 정확히 20px 함께 이동하며 세로 위치·크기·간격과 타일이
  변하지 않는 것을 실제 SVG 행렬로 확인했습니다. 후보·SVG·저장값·리셋·
  방향키·320px 화면을 통과했고 JS 오류는 없었습니다. 실제 렌더도 확인했습니다.
- 후속 임시 그룹 57,130 logical bytes를 소유 도구로 삭제했습니다.

## 직접 드래그 후속 변경

- 확대 미리보기에서 앞·뒤 커서를 개별 드래그하고 256px 캔버스 좌표를
  1px 단위로 맞춥니다. 커서 중심 X/Y 입력, 방향키 1px·Shift 10px 이동,
  겹친 뒤 커서 대상 고정을 제공합니다. 기존 슬라이더는 접힌 영역에 보존합니다.
- 기존 저장값과 배치를 유지하도록 기존 위치 계산에 개별 이동값을 더합니다.
  SVG/PNG·후보·설정·경계 경고에 동일 좌표를 적용합니다.
- Pointer Events와 안정된 stage의 pointer capture로 드래그 중 SVG 재렌더에도
  연속 이동을 유지합니다. 실제 네이티브 입력·앱 설정은 변경하지 않습니다.
- 검증 임시 경로: artifacts/logo-drag-run-20261116 (현재 작업 소유).
  실제 브라우저 마우스 드래그, 독립 이동, 확대 비율, 대상 고정, 키보드,
  저장 및 내보내기와 좁은 화면을 검사한 뒤 정리합니다.
- 최종 브라우저 검사 exit 0: 기존 배치 보존, 앞·뒤 각각의 실제 마우스
  드래그와 독립 이동, 앞을 잡아 가려진 뒤 커서 이동, 방향키/Shift,
  X 수치 입력, 110% 확대에서도 1px 격자, 저장 복구·SVG·리셋·320px
  가로 넘침 없음·JS 오류 없음. 실제 편집 화면 렌더도 확인했습니다.
  첫 테스트의 반올림 경계 오차와 가려진 뒷면을 누른 테스트 좌표를
  수정했습니다. 제품의 강제 대상 선택 경로는 별도로 검증했습니다.
- 임시 그룹 67,950 logical bytes는 소유 도구로 삭제했고 경로 부재를 확인했습니다.

## 커서 형상 탐색 후속 변경

- 별도 간단한 docs/visualizations/cursor-shape-lab.html을 만듭니다.
  모서리 반경과 오른쪽 아래 다리의 수평 기준 각도만 조정합니다.
  네이티브 원본, 수정 단일 커서, 겹친 커서와 실제 크기 비교를 제공합니다.
- 네이티브 직선부를 연장해 꼭짓점을 복원하고 원형 필렛으로 재구성합니다.
  다리 하단 연장 꼭짓점은 고정하며 각도에 따라 상단 접점을 바꿉니다.
  인접 필렛이 겹치면 공통 반경을 줄이고 실제 반경을 표시합니다.
- 기존 로고 배치 및 실제 커서는 변경하지 않습니다. 검증 산출물은
  artifacts/cursor-shape-run-20261116의 현재 작업 소유이며 검증 뒤 정리합니다.
- 검증 exit 0: 기본 형상과 원본을 경로 길이 정규화 101지점에서 비교한
  최대 편차는 0.0000063 source unit입니다. 반경 4종 × 각도 3종에서
  유효한 경로와 반경 자동 제한을 확인했습니다. 가이드·SVG 저장 및
  MIT 고지·리셋·320px 가로 넘침 없음·JS 오류 없음을 검증했고,
  기본/변경/좁은 화면 렌더를 직접 확인했습니다.
- 임시 그룹 153,663 logical bytes를 소유 도구로 삭제했고 실제 경로 부재를 확인했습니다.

## 반경 1.2를 배치 HTML에 적용

- 사용자 지정 반경 1.2를 기존 agent-logo-lab.html의 공통 커서 경로에 적용합니다.
  각도는 원본 그대로, 위치·크기·투명도 저장 및 드래그는 유지합니다.
- cursor-shape-lab.html의 검증된 필렛 계산으로 경로를 생성하며 출처·설정·
  SVG 내보내기에 변경 반경을 기록합니다. 실제 앱 커서는 변경하지 않습니다.
- 임시 검증은 artifacts/logo-radius-run-20261116에서 수행하고 정리합니다.
- 브라우저 검사 exit 0: 앞·뒤 경로가 형상 도구의 반경 1.2와 일치하며,
  원본 각도 56.836081904164104°를 유지합니다. 기존 저장값 전체 보존,
  후보 9개·SVG 반경 기록·PNG 256px·방향키 이동·JS 오류 없음 확인.
  수정한 배치 화면의 실제 렌더를 검토했습니다.
- 임시 그룹 70,909 logical bytes를 소유 도구로 삭제하고 경로 부재를 확인했습니다.
