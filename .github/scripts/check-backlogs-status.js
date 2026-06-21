const { execSync } = require("child_process");

/**
 * Generates a GraphQL query to fetch backlog items from GitHub Projects V2.
 *
 * The query retrieves project items with their SSR numbers and status fields,
 * filtered by repository. Supports pagination for large datasets.
 *
 * @param {string|null} cursor - Pagination cursor for fetching next page of results (null for first page)
 * @returns {string} JSON stringified GraphQL query ready for API request
 */
function generateGraphQLQuery(cursor) {
  const query = `{
          organization(login: "${process.env.REPO_OWNER}") {
              projectV2(number: ${process.env.KEP_PROJECT_ID}) {
                  items(first: 100${cursor ? `, after: "${cursor}"` : ""}) {
                      pageInfo {
                          hasNextPage
                          endCursor
                      }
                      nodes {
                          content {
                              ... on Issue {
                                  repository {
                                      name
                                  }
                              }
                          }
                          fieldValues(first: 20) {
                              nodes {
                                  ... on ProjectV2ItemFieldTextValue {
                                      text
                                      field {
                                          ... on ProjectV2Field {
                                              name
                                          }
                                      }
                                  }
                                  ... on ProjectV2ItemFieldSingleSelectValue {
                                      name
                                      field {
                                          ... on ProjectV2SingleSelectField {
                                              name
                                          }
                                      }
                                  }
                              }
                          }
                      }
                  }
              }
          }
      }`;
  return JSON.stringify({ query });
}

/**
 * Displays the status of backlog items in a formatted way.
 *
 * For each backlog item, it constructs a URL to the corresponding GitHub Project item
 * using the SSR number and filters by the repository name.
 *
 * @param {Array} backlogs - Array of backlog items with SSR and status properties
 */
function showBacklogsStatus(backlogs) {
  console.log("🔍 Backlogs statuses:");

  backlogs.forEach(({ SSR, status }) => {
    const encodeQuery = encodeURIComponent(`ssr:"${SSR}"`)
    console.log(`- ${SSR} (${status}) https://github.com/orgs/${process.env.REPO_OWNER}/projects/${process.env.KEP_PROJECT_ID}/views/1?filterQuery=${encodeQuery}`);
  });
}

/**
 * Builds a cURL command to execute a GraphQL query against the GitHub API.
 *
 * The command includes necessary headers for authentication and content type,
 * and constructs the API endpoint URL with the query payload.
 *
 * @param {string} query - JSON stringified GraphQL query to be executed
 * @returns {string} cURL command string ready for execution
 */
function buildCurlCommand(query) {
  return [
    "curl",
    "-X",
    "POST",
    "-H",
    `"Authorization: Bearer ${process.env.GITHUB_TOKEN}"`,
    "-H",
    '"Content-Type: application/json"',
    "-H",
    '"User-Agent: GitHub-Actions-Script"',
    "-d",
    `'${query}'`,
    "https://api.github.com/graphql",
    "-s",
  ].join(" ");
}

/**
 * Executes a GraphQL query against the GitHub API using cURL.
 *
 * This function builds the cURL command, executes it, and parses the response
 * into a JSON object.
 *
 * @param {string} query - JSON stringified GraphQL query to be executed
 * @returns {Object} Parsed JSON response from the API
 */
function executeGraphQLQuery(query) {
  const curlCommand = buildCurlCommand(query);
  const response = execSync(curlCommand, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  return JSON.parse(response);
}

/**
 * Extracts backlog data from the parsed GraphQL response.
 *
 * This function extracts the nodes array and pageInfo object from the response,
 * which contain the backlog items and pagination information.
 *
 * @param {Object} parsedResponse - Parsed JSON response from the API
 * @returns {Object} Object containing the backlog items and pagination information
 */
function extractBacklogsData(parsedResponse) {
  const responseData =
    parsedResponse?.data?.organization?.projectV2?.items || {};
  return {
    backlogs: responseData?.nodes || [],
    pageInfo: responseData?.pageInfo || {},
  };
}

/**
 * Retrieves all backlog items from GitHub Projects V2.
 *
 * This function recursively fetches backlog items in batches using pagination,
 * and combines them into a single array.
 *
 * @param {string|null} cursor - Pagination cursor for fetching next page of results (null for first page)
 * @param {Array} allBacklogs - Array of all backlog items collected so far (used for recursion)
 * @returns {Array} Array of all backlog items
 */
function getBacklogs(cursor = null, allBacklogs = []) {
  const query = generateGraphQLQuery(cursor);
  const parsedResponse = executeGraphQLQuery(query);

  const { backlogs, pageInfo } = extractBacklogsData(parsedResponse);

  allBacklogs = [...allBacklogs, ...backlogs];

  if (pageInfo.hasNextPage) {
    return getBacklogs(pageInfo.endCursor, allBacklogs);
  }

  return allBacklogs;
}

/**
 * Extracts the SSR number and status fields from a backlog item.
 *
 * This function searches for the SSR number and status fields in the fieldValues array,
 * and returns an object with these values.
 *
 * @param {Object} backlog - Backlog item object containing fieldValues array
 * @returns {Object} Object with SSR and status fields, or null if fields not found
 */
function extractBacklogFields(backlog) {
  const ssrNumberField = backlog.fieldValues.nodes.find(
    (subItem) => subItem?.field?.name === "SSR"
  );
  const statusField = backlog.fieldValues.nodes.find(
    (subItem) => subItem?.field?.name === "Status"
  );

  if (!ssrNumberField || !statusField) return null;
  return {
    SSR: ssrNumberField?.text || "",
    status: statusField?.name || "",
  };
}

/**
 * Filters backlog items by repository name.
 *
 * This function returns an array of backlog items that match the given repository name.
 *
 * @param {Array} backlogs - Array of backlog items
 * @param {string} repoName - Name of the repository to filter by
 * @returns {Array} Array of backlog items filtered by repository name
 */
function filterBacklogsByRepository(backlogs, repoName) {
  return backlogs.filter(
    (backlog) => backlog?.content?.repository?.name === repoName
  );
}

/**
 * Filters backlog items by task list.
 *
 * This function returns an array of backlog items that match the given task list.
 *
 * @param {Array} backlogs - Array of backlog items
 * @param {Array} taskList - Array of task IDs
 * @returns {Array} Array of backlog items filtered by task list
 */
function filterBacklogsByTaskList(backlogs, taskList) {
  return backlogs.filter((backlog) => taskList.includes(backlog?.SSR));
}

/**
 * Deduplicates backlog items by SSR number.
 *
 * This function returns an object with SSR numbers as keys and their corresponding statuses as values.
 *
 * @param {Array} backlogs - Array of backlog items
 * @returns {Object} Object with SSR numbers as keys and their corresponding statuses as values
 */
function deduplicateBacklogs(backlogs) {
  return backlogs.reduce((acc, backlog) => {
    if (!acc[backlog.SSR]) {
      acc[backlog.SSR] = backlog.status;
    }
    return acc;
  }, {});
}

/**
 * Processes backlog items by filtering them by repository and task list,
 * extracting their fields, and deduplicating them by SSR number.
 *
 * @param {Array} allBacklogs - Array of all backlog items
 * @returns {Object} Object with SSR numbers as keys and their corresponding statuses as values
 */
function processBacklogs(allBacklogs) {
  const [_, repoName] = process.env.REPO_NAME.split("/");
  const backlogsByRepository = filterBacklogsByRepository(
    allBacklogs,
    repoName
  );

  const mappedBacklogs = backlogsByRepository.map(extractBacklogFields);

  const task_list = (process.env.TASK_LIST || "").split(", ");
  const backlogsByTaskList = filterBacklogsByTaskList(
    mappedBacklogs,
    task_list
  );

  return deduplicateBacklogs(backlogsByTaskList);
}

(() => {
  try {
    const allBacklogs = getBacklogs(null, []);
    const processedBacklogs = processBacklogs(allBacklogs);

    showBacklogsStatus(
      Object.entries(processedBacklogs).map(([SSR, status]) => ({
        SSR,
        status,
      }))
    );

    const uncompletedBacklogs = Object.entries(processedBacklogs).filter(
      ([_, status]) => status && !status.includes("Finished")
    );
    if (uncompletedBacklogs.length > 0) {
      console.error(
        "❌ There are some backlogs that are not completed. Please check the backlogs and complete them."
      );
      process.exit(1);
    }
    console.log("✅ All backlogs are completed.");
  } catch (error) {
    console.error("❌ Error retrieving backlogs:", error.message);
    process.exit(1);
  }
})();
