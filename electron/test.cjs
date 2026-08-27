const fs = require('fs');
const path = require('path');

console.log('--- SYSTEM DIAGNOSTIC ---');
console.log('CWD:', process.cwd());
console.log('Platform:', process.platform);

const testPaths = [
  'C:\\Users\\ADMIN\\Music',
  'C:\\Users\\ADMIN\\Documents\\Music',
  'D:\\Music',
  path.join(process.env.USERPROFILE, 'Music')
];

testPaths.forEach(p => {
  try {
    const exists = fs.existsSync(p);
    console.log(`Path: ${p} | Exists: ${exists}`);
    if (exists) {
      console.log(`  Contents:`, fs.readdirSync(p).slice(0, 5));
    }
  } catch (e) {
    console.log(`  Error on ${p}:`, e.message);
  }
});

// Check if ADMIN exists
try {
    const users = fs.readdirSync('C:\\Users');
    console.log('Users in C:\\Users:', users);
} catch (e) {}

console.log('--- END DIAGNOSTIC ---');
