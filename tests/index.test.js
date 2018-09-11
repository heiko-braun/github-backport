// @flow strict

import {
  deleteReference,
  fetchReferenceSha,
} from "shared-github-internals/lib/git";
import { createTestContext } from "shared-github-internals/lib/tests/context";
import {
  createPullRequest,
  createReferences,
  fetchReferenceCommits,
} from "shared-github-internals/lib/tests/git";

import backportPullRequest from "../src";

let octokit, owner, repo;

beforeAll(() => {
  ({ octokit, owner, repo } = createTestContext());
});

describe("nominal behavior", () => {
  const [initial, dev, feature1st, feature2nd] = [
    "initial",
    "dev",
    "feature 1st",
    "feature 2nd",
  ];

  const [initialCommit, devCommit, feature1stCommit, feature2ndCommit] = [
    {
      lines: [initial, initial, initial],
      message: initial,
    },
    {
      lines: [dev, initial, initial],
      message: dev,
    },
    {
      lines: [dev, feature1st, initial],
      message: feature1st,
    },
    {
      lines: [dev, feature1st, feature2nd],
      message: feature2nd,
    },
  ];

  const state = {
    initialCommit,
    refsCommits: {
      dev: [devCommit],
      feature: [devCommit, feature1stCommit, feature2ndCommit],
      master: [],
    },
  };

  let actualBase,
    actualBody,
    actualHead,
    actualTitle,
    backportedPullRequestNumber,
    deleteReferences,
    featurePullRequestNumber,
    givenBase,
    givenBody,
    givenTitle,
    refsDetails;

  beforeAll(async () => {
    ({ deleteReferences, refsDetails } = await createReferences({
      octokit,
      owner,
      repo,
      state,
    }));
    givenBase = refsDetails.master.ref;
    featurePullRequestNumber = await createPullRequest({
      base: refsDetails.dev.ref,
      head: refsDetails.feature.ref,
      octokit,
      owner,
      repo,
    });
    givenBody = `Backport #${featurePullRequestNumber}.`;
    givenTitle = `Backport #${featurePullRequestNumber} on ${givenBase}`;
    backportedPullRequestNumber = await backportPullRequest({
      base: givenBase,
      body: givenBody,
      number: featurePullRequestNumber,
      octokit,
      owner,
      repo,
      title: givenTitle,
    });
    ({
      data: {
        base: { ref: actualBase },
        body: actualBody,
        head: { ref: actualHead },
        title: actualTitle,
      },
    } = await octokit.pullRequests.get({
      number: backportedPullRequestNumber,
      owner,
      repo,
    }));
  }, 30000);

  afterAll(async () => {
    await deleteReferences();
    await deleteReference({
      octokit,
      owner,
      ref: actualHead,
      repo,
    });
  });

  test("pull request made on the expected base", () => {
    expect(actualBase).toBe(givenBase);
  });

  test("given body is respected", () => {
    expect(actualBody).toBe(givenBody);
  });

  test("head default is respected", () => {
    expect(actualHead).toBe(
      `backport-${featurePullRequestNumber}-on-${givenBase}`
    );
  });

  test("given title is respected", () => {
    expect(actualTitle).toBe(givenTitle);
  });

  test("commits on the backported pull request are the expected ones", async () => {
    const actualCommits = await fetchReferenceCommits({
      octokit,
      owner,
      ref: actualHead,
      repo,
    });
    expect(actualCommits).toEqual([
      initialCommit,
      {
        lines: [initial, feature1st, initial],
        message: feature1st,
      },
      {
        lines: [initial, feature1st, feature2nd],
        message: feature2nd,
      },
    ]);
  });
});

describe("atomicity", () => {
  const [initial, dev, feature] = ["initial", "dev", "feature"];

  const [initialCommit, devCommit, featureCommit] = [
    {
      lines: [initial],
      message: initial,
    },
    {
      lines: [dev],
      message: dev,
    },
    {
      lines: [feature],
      message: feature,
    },
  ];

  const state = {
    initialCommit,
    refsCommits: {
      dev: [devCommit],
      feature: [featureCommit],
      master: [],
    },
  };

  let deleteReferences, featurePullRequestNumber, refsDetails;

  beforeAll(async () => {
    ({ deleteReferences, refsDetails } = await createReferences({
      octokit,
      owner,
      repo,
      state,
    }));
    featurePullRequestNumber = await createPullRequest({
      base: refsDetails.master.ref,
      head: refsDetails.feature.ref,
      octokit,
      owner,
      repo,
    });
  }, 20000);

  afterAll(async () => {
    await deleteReferences();
  });

  test(
    "whole operation aborted when the commits cannot be cherry-picked",
    async () => {
      const head = `backport-${featurePullRequestNumber}-on-${
        refsDetails.dev.ref
      }`;

      const ensureHeadRefExists = () =>
        fetchReferenceSha({ octokit, owner, ref: head, repo });

      let intercepted = false;

      await expect(
        backportPullRequest({
          async _intercept() {
            await ensureHeadRefExists();
            intercepted = true;
          },
          base: refsDetails.dev.ref,
          head,
          number: featurePullRequestNumber,
          octokit,
          owner,
          repo,
        })
      ).rejects.toThrow(/could not be cherry-picked/u);

      expect(intercepted).toBeTruthy();

      await expect(ensureHeadRefExists()).rejects.toThrow(/Not Found/u);
    },
    20000
  );
});
