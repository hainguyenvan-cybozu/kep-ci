const { execSync } = require("child_process");
const fs = require("fs");

const KEYS = {
  Backlog_Management: "Backlog_Management",
  Backlog_Version: "Version",
  Ticket: "Ticket",
  Status: "Status",
  Record_No: "Record_No",
};

/**
 * Validates the configuration of the environment variables.
 *
 * This function checks if all the required environment variables are set.
 * If not, it logs an error message and exits the process with a status code of 1.
 */
function validateConfig() {
  const requiredEnv = [
    "KEP_PROJECT_ID",
    "KINTONE_SUBDOMAIN",
    "KEP_PLUGINS_MANAGEMENT_APP_ID",
    "KEP_PLUGINS_MANAGEMENT_RECORD_NUMBER",
    "KEP_PLUGINS_MANAGEMENT_APP_API_TOKEN",
    "KEP_SSR_APP_ID",
    "KEP_SSR_APP_API_TOKEN",
  ];
  const missingEnv = requiredEnv.filter((env) => !process.env[env]);

  if (missingEnv.length > 0) {
    console.error(
      "❌ Missing required environment variables:",
      missingEnv.join(", ")
    );
    console.error("Please set the following GitHub Secrets:");
    missingEnv.forEach((key) => console.error(`- ${key}`));
    process.exit(1);
  }
}

/**
 * Retrieves the backlog management record from the kintone EP Plug-ins Management app.
 *
 * This function constructs a cURL command to retrieve the record from the kintone API,
 * and executes it using execSync.
 *
 * @returns {Object} Parsed JSON response from the API
 */
function getBacklogManagementRecord() {
  console.log(`🔍 Retrieving task list from kintone EP Plug-ins Management app ... ${process.env.KINTONE_SUBDOMAIN}/k/${process.env.KEP_PLUGINS_MANAGEMENT_APP_ID}/show#record=${process.env.KEP_PLUGINS_MANAGEMENT_RECORD_NUMBER}&tabcode=backlog_management`);

  const curlCommand = `curl -X GET '${process.env.KINTONE_SUBDOMAIN}/k/v1/record.json' -H 'X-Cybozu-API-Token: ${process.env.KEP_PLUGINS_MANAGEMENT_APP_API_TOKEN}' -H 'Content-Type: application/json' -d '{"app": ${process.env.KEP_PLUGINS_MANAGEMENT_APP_ID}, "id": ${process.env.KEP_PLUGINS_MANAGEMENT_RECORD_NUMBER}}'`;
  const response = execSync(curlCommand, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  return JSON.parse(response);
}

/**
 * Filters the task list in the release version.
 *
 * This function filters tasks that are included in the upcoming release.
 *
 * @param {Object} backlogManagementRecord - Backlog management record from the kintone EP Plug-ins Management app
 * @returns {Array} Array of task IDs
 */
function filterTaskListInReleaseVersion(backlogManagementRecord) {
  const { record } = backlogManagementRecord;
  const backlogManagementRows = record[KEYS.Backlog_Management].value;

  const lastestBacklogVersion = process.env.UPCOMING_RELEASE_VERSION;

  console.log(
    `🔍 Retrieving SSR tasks for release version (${lastestBacklogVersion}):`
  );

  return backlogManagementRows
    .filter((row) => {
      return row.value[KEYS.Backlog_Version].value === lastestBacklogVersion;
    })
    .map((row) => {
      const ticket = row.value[KEYS.Ticket].value;
      const regex = /SSR-(\d+)/;

      const [taskId] = ticket.match(regex);
      return taskId;
    });
}

/**
 * Displays the status of tasks in a formatted way.
 *
 * For each task, it constructs a URL to the corresponding kintone record using the task ID.
 *
 * @param {Array} taskStatuses - Array of task statuses with task ID and status
 */
function showTaskStatuses(taskStatuses) {
  taskStatuses.forEach((taskStatus) => {
    const [_, numberOfTaskId] = taskStatus.taskId.split("-");
    console.log(`- ${taskStatus.taskId} (${taskStatus.status}) ${process.env.KINTONE_SUBDOMAIN}/k/${process.env.KEP_SSR_APP_ID}/show#record=${numberOfTaskId}`)
  });
}

/**
 * Retrieves the tasks from the kintone SSR app.
 *
 * This function constructs a cURL command to retrieve the tasks from the kintone API,
 * and executes it using execSync.
 *
 * @param {Array} taskList - Array of task IDs
 * @returns {Object} Parsed JSON response from the API
 */
function getTasks(taskList) {
  try {
    const tasks = taskList.map((task) => `"${task}"`).join(", ");
    const query = `${KEYS.Record_No} in (${tasks})`;
    const encodedQuery = encodeURIComponent(query);

    const curlCommand = `curl -X GET '${process.env.KINTONE_SUBDOMAIN}/k/v1/records.json?app=${process.env.KEP_SSR_APP_ID}&query=${encodedQuery}' -H 'X-Cybozu-API-Token: ${process.env.KEP_SSR_APP_API_TOKEN}'`;
    const response = execSync(curlCommand, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    return JSON.parse(response);
  } catch (error) {
    console.error("❌ Error retrieving tasks:", error.message);
    throw error;
  }
}

/**
 * Maps the task records to an array of task statuses.
 *
 * This function maps the task records to an array of task statuses with task ID and status.
 *
 * @param {Array} taskRecords - Array of task records
 * @returns {Array} Array of task statuses with task ID and status
 */
function mapTaskStatuses(taskRecords) {
  return taskRecords.map((taskRecord) => {
    return {
      taskId: taskRecord[KEYS.Record_No].value,
      status: taskRecord[KEYS.Status].value,
    };
  });
}

/**
 * Retrieves the uncompleted tasks from the task statuses.
 *
 * This function filters the task statuses to return only the tasks that are not completed.
 *
 * @param {Array} taskStatuses - Array of task statuses with task ID and status
 * @returns {Array} Array of uncompleted task statuses with task ID and status
 */
function getUncompletedTasks(taskStatuses) {
  return taskStatuses.filter((taskStatus) => taskStatus.status !== "Finished");
}

/**
 * Sets the task list output to the GitHub Actions environment variables.
 *
 * This function sets the task list output to the GitHub Actions environment variables.
 *
 * @param {Array} taskRecords - Array of task records
 */
function setTaskListOutput(taskRecords) {
  const taskList = taskRecords.map((taskRecord) => {
    return taskRecord[KEYS.Record_No].value;
  });
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `task_list=${taskList.join(", ")}\n`
  );
}

(() => {
  try {
    validateConfig();
    const backlogManagementRecord = getBacklogManagementRecord();
    const tasks = filterTaskListInReleaseVersion(backlogManagementRecord);

    const { records: taskRecords } = getTasks(tasks);
    const taskStatuses = mapTaskStatuses(taskRecords);

    showTaskStatuses(taskStatuses);
    setTaskListOutput(taskRecords);

    const uncompletedTasks = getUncompletedTasks(taskStatuses);
    if (uncompletedTasks.length > 0) {
      console.log(
        "❌ There are some tasks that are not completed. Please check the tasks and complete them."
      );
      process.exit(1);
    }
    console.log("✅ All tasks are completed");
  } catch (error) {
    console.error("❌ Error retrieving tasks:", error.message);
    process.exit(1);
  }
})();
