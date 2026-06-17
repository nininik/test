/**
 * kakao-callback.js
 * nininik.github.io/test — 카카오 로그인 콜백 처리
 *
 * 사용법: 원래 사이트(index.html)의 </body> 직전에 추가
 *   <script src="kakao-callback.js"></script>
 *
 * 동작 흐름:
 *   카카오 로그인 완료
 *     → Firebase Function이 /?login=success&token=...&nickname=...&photo=... 로 리다이렉트
 *     → 이 스크립트가 URL 파라미터를 읽고
 *     → 팝업을 연 부모 창(물개맵)으로 postMessage 전송
 *     → 팝업 자동 닫힘
 */

(function () {
  const MUGAEMAP_ORIGIN = '*'; // 물개맵 도메인이 확정되면 해당 URL로 교체 권장
  // 예: const MUGAEMAP_ORIGIN = 'https://mugaemap.web.app';

  const params   = new URLSearchParams(location.search);
  const loginResult = params.get('login');

  if (loginResult === 'success') {
    const token    = params.get('token')    || '';
    const nickname = decodeURIComponent(params.get('nickname') || '');
    const photo    = decodeURIComponent(params.get('photo')    || '');

    if (window.opener) {
      // 부모 창(물개맵)으로 로그인 정보 전달
      window.opener.postMessage(
        { type: 'KAKAO_LOGIN_SUCCESS', token, nickname, photo },
        MUGAEMAP_ORIGIN
      );
      // 잠깐 후 팝업 닫기 (postMessage 전달 여유)
      setTimeout(() => window.close(), 300);
    }

  } else if (loginResult === 'fail') {
    // 로그인 실패 시
    if (window.opener) {
      window.opener.postMessage(
        { type: 'KAKAO_LOGIN_FAIL' },
        MUGAEMAP_ORIGIN
      );
      setTimeout(() => window.close(), 300);
    }
  }
})();
