const fs = require('fs');
const path = require('path');

const defaultPlaybookPath = path.resolve('docs/guides/ROLLOUT_PLAYBOOK.md');
const targetPath = path.resolve(process.argv[2] || defaultPlaybookPath);

const requiredTopLevelHeadings = [
    '## Environment Matrix (dev/staging/prod)',
    '## Rollback Commands: Mini Program',
    '## Rollback Commands: Cloud Functions'
];

const phaseHeadings = [
    '## Phase Gate: 5%',
    '## Phase Gate: 10%',
    '## Phase Gate: 50%',
    '## Phase Gate: 100%'
];

function fail(message, details) {
    console.error(`[rollout-validator] ${message}`);
    if (details && details.length > 0) {
        for (const detail of details) {
            console.error(`- ${detail}`);
        }
    }
    process.exit(1);
}

if (!fs.existsSync(targetPath)) {
    fail('Playbook file not found.', [targetPath]);
}

const raw = fs.readFileSync(targetPath, 'utf8');
const missingSections = [];

for (const heading of requiredTopLevelHeadings) {
    if (!raw.includes(heading)) {
        missingSections.push(heading);
    }
}

const phasePositions = phaseHeadings.map((heading) => raw.indexOf(heading));
for (let i = 0; i < phasePositions.length; i += 1) {
    if (phasePositions[i] === -1) {
        missingSections.push(phaseHeadings[i]);
    }
}

for (let i = 1; i < phasePositions.length; i += 1) {
    if (phasePositions[i - 1] !== -1 && phasePositions[i] !== -1 && phasePositions[i] < phasePositions[i - 1]) {
        fail('Phase order is invalid. Expected 5% -> 10% -> 50% -> 100%.');
    }
}

for (let i = 0; i < phaseHeadings.length; i += 1) {
    if (phasePositions[i] === -1) {
        continue;
    }

    const blockStart = phasePositions[i];
    const nextPhase = phasePositions.slice(i + 1).find((position) => position !== -1);
    const blockEnd = typeof nextPhase === 'number' ? nextPhase : raw.length;
    const phaseBlock = raw.slice(blockStart, blockEnd);

    if (!phaseBlock.includes('### Stop Criteria')) {
        missingSections.push(`${phaseHeadings[i]} -> ### Stop Criteria`);
    }

    if (!phaseBlock.includes('### Rollback Triggers')) {
        missingSections.push(`${phaseHeadings[i]} -> ### Rollback Triggers`);
    }
}

if (missingSections.length > 0) {
    fail('Missing required rollout sections.', missingSections);
}

console.log('[rollout-validator] PASS');
console.log(`[rollout-validator] File: ${targetPath}`);
console.log('[rollout-validator] Gates: 5% -> 10% -> 50% -> 100%');
