/** One `[issuetracker "Label"]` entry parsed from a repo's `.issuetracker` file. */
export type IssueTrackerPattern = {
  label: string;
  regex: string;
  url: string;
};

/** An issue reference resolved against a repo's configured `.issuetracker` patterns. */
export type IssueMatch = {
  label: string;
  ref: string;
  url: string;
};
