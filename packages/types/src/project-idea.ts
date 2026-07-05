/** Result of a PROJECT_IDEA_GENERATE call — exactly one of the two shapes is set. */
export type ProjectIdeaGenerateResult =
  | { name: string; techStack: string; description: string; error?: undefined }
  | { name?: undefined; techStack?: undefined; description?: undefined; error: string };
