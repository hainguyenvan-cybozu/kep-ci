const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Configuration
const config = {
  owner: process.env.REPO_OWNER,
  repo: "kep-common",
};

/**
 * Retrieves the open pull requests from the KEP common repository.
 *
 * This function constructs a cURL command to retrieve the pull requests from the GitHub API,
 * and executes it using execSync.
 *
 * @returns {Array} Array of pull requests
 */
function getOpenPullRequests() {
  try {
    const command = `gh pr list --repo ${config.owner}/${config.repo} --state open --json title,url`;
    const result = execSync(command, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(result);
  } catch (error) {
    console.error("Error fetching pull requests:", error.message);
    throw error;
  }
}

/**
 * Checks if the job should be skipped based on the folder structure.
 *
 * This function checks if the current directory contains a customization folder or a plugin/src/common folder.
 * If it does, the job should be skipped.
 *
 * @returns {boolean} True if the job should be skipped, false otherwise
 */
function shouldSkipJob() {
  const currentDir = process.cwd();

  // Check for customization folder
  if (fs.existsSync(path.join(currentDir, "customization"))) {
    console.log("Found customization folder - skipping KEP common PR check");
    return true;
  }

  // Check for plugin folder with common subdirectory
  if (fs.existsSync(path.join(currentDir, "plugin", "src", "common"))) {
    console.log("Found plugin/src/common folder - running KEP common PR check");
    return false;
  }

  if (!fs.existsSync(path.join(currentDir, "packages"))) {
    console.log("No packages folder found - skipping KEP common PR check");
    return true;
  }

  console.log(
    "Found packages folder (monorepo) - checking for customization and plugin folders"
  );

  // Check each package for customization folder
  const packagesDir = path.join(currentDir, "packages");
  const packages = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  for (const packageName of packages) {
    const packagePath = path.join(packagesDir, packageName);

    // Check for customization folder in package
    if (fs.existsSync(path.join(packagePath, "customization"))) {
      console.log(
        `Found customization folder in package ${packageName} - skipping KEP common PR check`
      );
      return true;
    }

    // Check for plugin folder with common subdirectory in package
    if (fs.existsSync(path.join(packagePath, "plugin", "src", "common"))) {
      console.log(
        `Found plugin/src/common folder in package ${packageName} - running KEP common PR check`
      );
      return false;
    }
  }

  console.log(
    "No customization or plugin/src/common folders found in packages - skipping KEP common PR check"
  );
  return true;
}

/**
 * Checks the KEP common pull requests.
 *
 * This function checks the KEP common pull requests and skips the job if the folder structure contains a customization folder or a plugin/src/common folder.
 * If there are no open pull requests, the job will proceed with the release process.
 *
 * @returns {void}
 */
async function checkKepCommonPRs() {
  console.log("Checking if KEP common PR check should run...");

  if (shouldSkipJob()) {
    console.log("Skipping KEP common PR check based on folder structure");
    return;
  }

  console.log("Running KEP common PR check...");

  const pullRequests = getOpenPullRequests();

  if (pullRequests.length === 0) {
    console.log(
      "✅ No open pull requests found in KEP common project. Proceeding with release."
    );
    return;
  }

  console.log(
    "❌ You need to merge the following pull requests before continuing the release process:"
  );
  pullRequests.forEach((pullRequest) => {
    console.log(`- ${pullRequest.title} (${pullRequest.url})`);
  });
  console.log("❌ Please merge them and run the script again.");
  process.exit(1);
}

(() => {
  try {
    checkKepCommonPRs();
  } catch (error) {
    console.error("❌ Error checking KEP common pull requests:", error.message);
    process.exit(1);
  }
})();
