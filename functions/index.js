// functions/index.js
// 카카오 로그인 OAuth 처리 Firebase Function

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const axios = require('axios');
const qs = require('qs');

admin.initializeApp();

// ── Firebase Secret Manager에 저장된 값 참조 ──
// 배포 전에 아래 명령으로 등록:
//   firebase functions:secrets:set KAKAO_REST_API_KEY
//   firebase functions:secrets:set KAKAO_CLIENT_SECRET
const KAKAO_REST_API_KEY = defineSecret('KAKAO_REST_API_KEY');
const KAKAO_CLIENT_SECRET = null;

// ── 카카오 API 요청 헬퍼 ───────────────────────
async function kakaoCall(method, url, params, headers) {
  try {
    const res = await axios({ method, url, headers, data: params });
    return res.data;
  } catch (err) {
    return err.response?.data ?? { error: 'unknown_error' };
  }
}

// ── 리다이렉트 URI (Firebase Hosting URL로 자동 설정) ──
function getRedirectUri(req) {
  const host = req.headers['x-forwarded-host'] || req.hostname;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  return `${protocol}://${host}/auth/kakao/callback`;
}

// ── [1] 카카오 로그인 시작 ─────────────────────
exports.kakaoAuth = onRequest(
  { secrets: [KAKAO_REST_API_KEY] },
  (req, res) => {
    const redirectUri = encodeURIComponent(getRedirectUri(req));
    const kakaoUrl =
      `https://kauth.kakao.com/oauth/authorize` +
      `?client_id=${KAKAO_REST_API_KEY.value()}` +
      `&redirect_uri=${redirectUri}` +
      `&response_type=code`;
    res.redirect(kakaoUrl);
  }
);

// ── [2] 카카오 콜백: 인가코드 → 액세스토큰 → Firebase 커스텀 토큰 ──
exports.kakaoCallback = onRequest(
  { secrets: [KAKAO_REST_API_KEY] },
  async (req, res) => {
    const { code, error } = req.query;

    if (error || !code) {
      return res.redirect('/?login=fail');
    }

    // 1) 액세스 토큰 요청
    const tokenData = await kakaoCall(
      'POST',
      'https://kauth.kakao.com/oauth/token',
      qs.stringify({
        grant_type:   'authorization_code',
        client_id:    KAKAO_REST_API_KEY.value(),
        redirect_uri: getRedirectUri(req),
        code,
        ...(KAKAO_CLIENT_SECRET.value() && {
          client_secret: KAKAO_CLIENT_SECRET.value(),
        }),
      }),
      { 'content-type': 'application/x-www-form-urlencoded' }
    );

    if (!tokenData.access_token) {
      return res.redirect('/?login=fail');
    }

    // 2) 카카오 사용자 정보 조회
    const profile = await kakaoCall(
      'GET',
      'https://kapi.kakao.com/v2/user/me',
      null,
      { Authorization: `Bearer ${tokenData.access_token}` }
    );

    const uid      = `kakao:${profile.id}`;
    const nickname = profile.kakao_account?.profile?.nickname ?? '사용자';
    const photo    = profile.kakao_account?.profile?.thumbnail_image_url ?? null;

    // 3) Firebase Auth에 사용자 upsert
    try {
      await admin.auth().updateUser(uid, { displayName: nickname, photoURL: photo });
    } catch {
      await admin.auth().createUser({ uid, displayName: nickname, photoURL: photo });
    }

    // 4) Firestore에 사용자 정보 저장 (선택)
    await admin.firestore().collection('users').doc(uid).set(
      { uid, nickname, photo, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    // 5) Firebase 커스텀 토큰 발급 → 프론트로 전달
    const customToken = await admin.auth().createCustomToken(uid);

    // 프론트엔드로 리다이렉트 (토큰을 URL fragment로 전달)
    res.redirect(`/?login=success&token=${customToken}&nickname=${encodeURIComponent(nickname)}&photo=${encodeURIComponent(photo || '')}`);
  }
);

// ── [3] 로그아웃 (카카오 측 토큰 무효화) ─────────
exports.kakaoLogout = onRequest(
  { secrets: [KAKAO_REST_API_KEY] },
  async (req, res) => {
    const accessToken = req.query.accessToken;
    if (accessToken) {
      await kakaoCall(
        'POST',
        'https://kapi.kakao.com/v1/user/logout',
        null,
        { Authorization: `Bearer ${accessToken}` }
      );
    }
    res.json({ ok: true });
  }
);
