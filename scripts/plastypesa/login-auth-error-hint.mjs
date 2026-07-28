#!/usr/bin/env node
/**
 * P-LOGIN-AUTH-ERROR-HINT — live API must return 401 + clear credentials message
 * (not 500) for unknown email / wrong password.
 */
const API =
  process.env.PLASTYPESA_API_BASE ||
  'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';

async function login(email, password) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: r.status, body };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const cases = [
    ['missing-batch2@example.com', 'WrongPass1!'],
    ['test@plastypesa.com', 'definitely-wrong-password-xyz'],
  ];
  let pass = 0;
  for (const [email, password] of cases) {
    const { status, body } = await login(email, password);
    const msg = String(body?.message || '');
    console.log(JSON.stringify({ email, status, type: body?.type, message: msg }));
    assert(status === 401, `${email}: expected HTTP 401, got ${status}`);
    assert(body?.type === 'error', `${email}: expected type=error`);
    assert(
      /invalid email or password/i.test(msg),
      `${email}: expected credentials message, got ${msg}`,
    );
    pass += 1;
    console.log(`  PASS  ${email}`);
  }
  console.log(`login-auth-error-hint: ${pass}/${cases.length} green against ${API}`);
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
