const { execSync } = require('child_process');

function run(name, command) {
    console.log(`[verify] ${name}`);
    try {
        execSync(command, { stdio: 'inherit' });
    } catch (e) {
        process.exit(1);
    }
}

run('lint', 'npm run lint');
run('test', 'npm run test');
