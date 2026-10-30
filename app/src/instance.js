const os = require('os');

// EC2 instance metadata service (IMDSv2). Outside EC2 the calls time out
// quickly and we fall back to the hostname (the container ID under Docker).
const IMDS = 'http://169.254.169.254/latest';

let cached;

async function lookupInstanceId(timeoutMs = 500) {
  try {
    const tokenRes = await fetch(`${IMDS}/api/token`, {
      method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
    const token = await tokenRes.text();

    const idRes = await fetch(`${IMDS}/meta-data/instance-id`, {
      headers: { 'X-aws-ec2-metadata-token': token },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!idRes.ok) throw new Error(`instance-id ${idRes.status}`);
    return await idRes.text();
  } catch {
    return `local-${os.hostname()}`;
  }
}

async function getInstanceId() {
  if (!cached) cached = await lookupInstanceId();
  return cached;
}

module.exports = { getInstanceId };
