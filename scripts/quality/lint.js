const { execSync } = require('child_process');
const fs = require('fs');

const injectFailure = process.argv.includes('--inject-failure');

if (injectFailure) {
    console.error('[lint] Injected failure requested.');
    process.exit(2);
}

try {
    const files = execSync('git ls-files "*.js"', { encoding: 'utf8' })
        .split('\n')
        .filter(f => f.trim() && fs.existsSync(f));

    console.log(`[lint] Checking ${files.length} files...`);

    for (const file of files) {
        try {
            execSync(`node --check "${file}"`, { stdio: 'ignore' });
        } catch (e) {
            console.error(`[lint] Syntax error in ${file}`);
            process.exit(1);
        }
    }

    console.log('[lint] All files passed syntax check.');
} catch (e) {
    console.error('[lint] Failed to list files or check syntax.');
    process.exit(1);
}
