import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    repoRoot: text('repo_root').notNull(),
    adapterTypes: text('adapter_types').notNull(), // JSON array string
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('projects_workspace_slug').on(t.workspaceId, t.slug)],
);

export const environmentProfiles = sqliteTable('environment_profiles', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  name: text('name').notNull(),
  snapshotJson: text('snapshot_json'), // non-secret env snapshot
  createdAt: text('created_at').notNull(),
});

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: text('project_id').references(() => projects.id),
    environmentProfileId: text('environment_profile_id').references(
      () => environmentProfiles.id,
    ),
    suiteId: text('suite_id'),
    /** Same as verdict.runId — filesystem run folder name */
    neoxtenRunId: text('neoxten_run_id').notNull(),
    status: text('status').notNull(), // passed | failed | infra_failed
    exitCode: integer('exit_code').notNull(),
    configPath: text('config_path').notNull(),
    sourceRunDir: text('source_run_dir').notNull(),
    verdictJson: text('verdict_json').notNull(),
    manifestJson: text('manifest_json').notNull(),
    evidenceTimelineJson: text('evidence_timeline_json'),
    completedAt: text('completed_at').notNull(),
    createdAt: text('created_at').notNull(),
    /** Issue fingerprint for clustering (§9) */
    failureFingerprint: text('failure_fingerprint'),
    validationClosureJson: text('validation_closure_json'),
  },
  (t) => [
    index('runs_workspace_completed').on(t.workspaceId, t.completedAt),
    index('runs_neoxten_run_id').on(t.neoxtenRunId),
  ],
);

export const findings = sqliteTable(
  'findings',
  {
    id: text('id').primaryKey(),
    runDbId: text('run_db_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    payloadJson: text('payload_json').notNull(),
    fingerprint: text('fingerprint'),
    promotionState: text('promotion_state').notNull().default('run_only'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('findings_run_idx').on(t.runDbId)],
);

export const runArtifacts = sqliteTable(
  'run_artifacts',
  {
    id: text('id').primaryKey(),
    runDbId: text('run_db_id')
      .notNull()
      .references(() => runs.id),
    relativePath: text('relative_path').notNull(),
    kind: text('kind').notNull(),
    sha256: text('sha256'),
    bytes: integer('bytes'),
    blobKey: text('blob_key'), // sha256 content-addressed key when archived
  },
  (t) => [index('run_artifacts_run').on(t.runDbId)],
);

export const issues = sqliteTable(
  'issues',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: text('project_id').references(() => projects.id),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').notNull(),
    severity: text('severity').notNull().default('medium'),
    title: text('title').notNull(),
    classification: text('classification'),
    codeBridgeJson: text('code_bridge_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('issues_fingerprint').on(t.workspaceId, t.fingerprint)],
);

export const issueRuns = sqliteTable('issue_runs', {
  issueId: text('issue_id')
    .notNull()
    .references(() => issues.id),
  runDbId: text('run_db_id')
    .notNull()
    .references(() => runs.id),
});

export const patchProposals = sqliteTable('patch_proposals', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  projectId: text('project_id').references(() => projects.id),
  baseSha: text('base_sha').notNull(),
  unifiedDiff: text('unified_diff').notNull(),
  authorKind: text('author_kind').notNull(),
  state: text('state').notNull(),
  validationRunIdsJson: text('validation_run_ids_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const retestItems = sqliteTable(
  'retest_items',
  {
    id: text('id').primaryKey(),
    runDbId: text('run_db_id').references(() => runs.id, { onDelete: 'cascade' }),
    issueId: text('issue_id').references(() => issues.id, { onDelete: 'cascade' }),
    patchProposalId: text('patch_proposal_id').references(() => patchProposals.id, {
      onDelete: 'cascade',
    }),
    checkId: text('check_id').notNull(),
    rationale: text('rationale').notNull(),
    required: integer('required', { mode: 'boolean' }).notNull().default(true),
    status: text('status').notNull().default('pending'),
    waiveReason: text('waive_reason'),
    relatedFindingIdsJson: text('related_finding_ids_json'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('retest_items_run').on(t.runDbId),
    index('retest_items_patch').on(t.patchProposalId),
  ],
);

export const explainBindings = sqliteTable('explain_bindings', {
  id: text('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityKey: text('entity_key').notNull(),
  templateSlug: text('template_slug').notNull(),
  inputsHash: text('inputs_hash').notNull(),
  renderedJson: text('rendered_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const visualBaselines = sqliteTable(
  'visual_baselines',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: text('project_id').references(() => projects.id),
    baselineKey: text('baseline_key').notNull(),
    contentSha256: text('content_sha256').notNull(),
    approvedRunDbId: text('approved_run_db_id'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('visual_baselines_ws_key').on(t.workspaceId, t.baselineKey)],
);
