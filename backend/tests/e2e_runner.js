#!/usr/bin/env node

const { ensureServerRunning, stopServer, cleanupTestData } = require('./helpers');
const { runTier1Tests } = require('./tier1_coverage.test');
const { runTier2Tests } = require('./tier2_boundary.test');
const { runTier3Tests } = require('./tier3_combinations.test');
const { runTier4Tests } = require('./tier4_workflow.test');

// ANSI Color definitions
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgRed: '\x1b[41m\x1b[37m'
};

async function runE2ESuite() {
  console.log(`\n${COLORS.bright}${COLORS.cyan}===============================================================`);
  console.log(`🚀 ATEM Field Platform - E2E Integration Test Suite & Runner`);
  console.log(`===============================================================${COLORS.reset}\n`);

  let spawnedServer = null;
  let overallPassed = true;
  const summaryByTier = [];

  try {
    // Clean up test state before starting tests
    await cleanupTestData();

    // Step 0: Ensure backend server is active
    spawnedServer = await ensureServerRunning();

    const tiers = [
      { id: 1, name: 'Tier 1: Feature & Data Coverage (Supabase & REST APIs)', fn: runTier1Tests },
      { id: 2, name: 'Tier 2: Boundary & Validation Edge Cases', fn: runTier2Tests },
      { id: 3, name: 'Tier 3: Cross-Feature Combinations & Lifecycles', fn: runTier3Tests },
      { id: 4, name: 'Tier 4: Real-World Application E2E Workflow', fn: runTier4Tests }
    ];

    let grandTotalTests = 0;
    let grandTotalPass = 0;
    let grandTotalFail = 0;

    for (const tier of tiers) {
      console.log(`\n${COLORS.bright}${COLORS.yellow}---------------------------------------------------------------`);
      console.log(`📌 ${tier.name}`);
      console.log(`---------------------------------------------------------------${COLORS.reset}`);

      const startTime = Date.now();
      const testResults = await tier.fn();
      const duration = Date.now() - startTime;

      let tierPass = 0;
      let tierFail = 0;

      for (const t of testResults) {
        grandTotalTests++;
        if (t.passed) {
          tierPass++;
          grandTotalPass++;
          console.log(`  ${COLORS.green}✔ PASS${COLORS.reset}  ${t.name}`);
          if (t.detail) {
            console.log(`          ${COLORS.dim}➜ ${t.detail}${COLORS.reset}`);
          }
        } else {
          tierFail++;
          grandTotalFail++;
          overallPassed = false;
          console.log(`  ${COLORS.red}✖ FAIL${COLORS.reset}  ${t.name}`);
          console.log(`          ${COLORS.red}➜ Error: ${t.detail}${COLORS.reset}`);
        }
      }

      const passRate = testResults.length > 0 ? ((tierPass / testResults.length) * 100).toFixed(1) : '100.0';
      summaryByTier.push({
        id: tier.id,
        name: tier.name,
        total: testResults.length,
        passed: tierPass,
        failed: tierFail,
        passRate: `${passRate}%`,
        duration: `${duration}ms`
      });

      console.log(`  ${COLORS.dim}Tier Summary: ${tierPass}/${testResults.length} passed (${passRate}%) in ${duration}ms${COLORS.reset}`);
    }

    // Print Final Summary Table
    console.log(`\n\n${COLORS.bright}${COLORS.cyan}===============================================================`);
    console.log(`📊 OVERALL E2E TEST RESULTS SUMMARY`);
    console.log(`===============================================================${COLORS.reset}`);

    console.table(summaryByTier);

    const overallRate = grandTotalTests > 0 ? ((grandTotalPass / grandTotalTests) * 100).toFixed(1) : '100.0';

    console.log(`\n${COLORS.bright}Total Executed Tests: ${grandTotalTests}`);
    console.log(`Passed Tests: ${COLORS.green}${grandTotalPass}${COLORS.reset}`);
    console.log(`Failed Tests: ${grandTotalFail > 0 ? COLORS.red : COLORS.green}${grandTotalFail}${COLORS.reset}`);
    console.log(`Pass Rate: ${overallPassed ? COLORS.green : COLORS.red}${overallRate}%${COLORS.reset}\n`);

    if (overallPassed) {
      console.log(`${COLORS.bgGreen} RESULT: PASS - 100% of E2E Integration Tests Succeeded! ${COLORS.reset}\n`);
      process.exitCode = 0;
    } else {
      console.log(`${COLORS.bgRed} RESULT: FAIL - Some E2E Test Cases Failed! ${COLORS.reset}\n`);
      process.exitCode = 1;
    }

  } catch (fatalErr) {
    console.error(`\n${COLORS.red}CRITICAL RUNNER ERROR:${COLORS.reset}`, fatalErr.message);
    process.exitCode = 1;
  } finally {
    if (spawnedServer) {
      stopServer(spawnedServer);
    }
    // Final cleanup of temporary test records
    await cleanupTestData();
  }
}

// Execute suite if run directly
if (require.main === module) {
  runE2ESuite().then(() => {
    process.exit(process.exitCode || 0);
  });
}

module.exports = { runE2ESuite };
