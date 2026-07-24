import { getActiveSessions } from 'windows-media-sessions';

async function test() {
  console.log('Fetching active sessions...');
  try {
    const sessions = await getActiveSessions();
    console.log(JSON.stringify(sessions, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
