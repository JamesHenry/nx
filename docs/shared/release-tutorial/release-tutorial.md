# Nx't Level Publishing

> In this talk we will dig into practical examples of various approaches to versioning and publishing packages from an Nx workspace.

{% youtube
src="https://youtu.be/p5qW5-2nKqI"
title="Talk: Nx't Level Publishing"
/%}

Nx is a smart, fast and extensible build system. We know and love it for its ability to help us scaffold our repos and projects with customizable code generators, intelligently analyze our codebases to find relationships between different parts of our code, and run important tasks like tests and builds with maximum caching and efficiency. All of this helps us build better software faster.

But what about sharing that great software with the world outside our Nx workspace? That is exactly what we will cover in this talk.

We will initially focus on publishing JavaScript/TypeScript packages because that is the largest segment of our current userbase, but we will cover some exciting pieces related to other languages and ecosystems later on.

## Versioning and publishing today

Because Nx is capable of working with any valid JavaScript/TypeScript repo, you have always had a choice as to how you do versioning and publishing of code that will be published to a remote registry, such as npm.

Like with most things, you have the flexibility to chose an existing, fully-fledged solution from the community - such as Lerna, changesets, release-it, and more - or create your own bespoke solution using the powerful primitives that Nx provides.

For example, you could use the `nx:run-commands` executor to wrap the npm CLI and create a lightweight "version" and "publish" target on a project, and then create a generator which ensures that this target is available on all of the projects in your workspace.

This optionality is great because it allows our users to build whatever they want, but it can also be overwhelming. So this is why we have been working on something new within the core of Nx.

## Enter `nx release`

`nx release` is a new top level command on the Nx CLI which is designed to help you with versioning, changelog generation and publishing of your projects:

|                        |                                                                               |
| ---------------------- | ----------------------------------------------------------------------------- |
| `nx release version`   | Determine and apply version updates to projects and their dependents          |
| `nx release changelog` | Generate CHANGELOG.md files and optional Github releases based on git commits |
| `nx release publish`   | Take the freshly versioned projects and publish them to a remote registry     |

It is very early days and we are super excited for what this will become as we continue to build out its features and extensibility. You can expect to see its capabilities and, in particular, its documentation get fleshed out much more over the coming weeks, but we are excited to share this early milestone with you today.

The best way to get to know `nx release` is to see in action on workspaces of different shapes and sizes, so let's start with a simple example.

## `nx release` in action - single npm packages

Let's take a simple npm package and show how lightweight our setup with `nx release` can be.

Steps:

- npm init to create new package, add .gitignore to ignored node_modules
- Commit all that with `chore: initial commit` and tag that commit as v1.0.0
- Install nx and @nx/js plugin, add `"nx": {}` to package.json and commit that with `chore: add nx and @nx/js plugin`
- Make a change to the library source and commit that with `feat: new feature for the library`
- Run `nx release version` or `nx release v` with `--dry-run` or `-d`
  - Show the experience with prompting for a semver keyword or exact version
  - Show that you can pass a specifier and then highlight the diff output preview
- Run `nx release version` without `--dry-run`
- Run `nx release changelog 1.1.0` or `nx release c 1.1.0` with `--dry-run` or `-d`
  - Also run with the `--interactive` or `-i` flag and show how interactive mode allows customization of markdown
  - Show the diff output preview in all cases
- Commit the package.json version update and new CHANGELOG.md file with `chore: release v1.1.0`
- Run `nx release publish` or `nx release p` with `--dry-run` or `-d`
  - Show the output preview from npm CLI
- Run `nx release publish` without `--dry-run`
  - Show the output from npm CLI

So let's recap what we've managed to do here:

On an entirely vanilla npm package repo, we have added the nx and the @nx/js packages and an "nx" property to our package.json. Apart from that, this was entirely zero config, with no `nx.json` or `project.json`, no "version" or "publish" targets, and no extra tooling.

Nx was able to just do the right thing for this common versioning and publishing workflow, and we had a lot of control over our experience thanks to the `--dry-run` flag being implemented on every command.

Let's take things up a notch and look at a more complex example.

## `nx release` in action - pnpm powered package based monorepo

This time we have a package based monorepo in which we have local packages which depend on one another. pnpm workspaces is used to link these packages together for local development purposes, and this time the packages have a required build step because they are written in TypeScript. The build script simply invokes the TypeScript compiler and outputs the compiled JavaScript to a `dist` folder. It has already had at least one release so there is an existing CHANGELOG.md file in place this time.

It is the exact kind of monorepos that people craft by hand when they are not already using Nx and its powerful code generators and task executors.

Steps:

- Commit the above described setup with `feat: initial publish of pkg-a and pkg-b` and tag that commit as v1.0.0
- Add a mixture of commits to pkg-a and pkg-b:
  - fix(pkg-a): squashing bugs
  - feat(pkg-b): brand new thing
  - feat(pkg-a): new hotness
  - feat(pkg-b): and another new capability
  - fix: all packages fixed
- Run `nx release v minor` and note the output shows that we are updating not just the packages, but also the dependency relationships between the packages
- Run `nx release c 1.1.0 --dry-run` and note that the CHANGELOG.md file is prepended with the new release notes
  - Note that the commits we added above have been nicely organized to make them most readable and easy to visually scan:
    - First organized by type, then by scopes (where scopes are sorted alphabetically), then sorted chronologically within the type and scope groupings
- Now let's explore an additional capability of `nx release changelog`, namely generating Github releases.
  - Run `nx release c 1.1.0 --dry-run` but this time add `--create-release=github`
  - Now we can see a preview not just of what will be written to the CHANGELOG.md file on disk, but also what will be creating as a release on Github.
  - NOTE: If you want to go with only Github releases you can disable the CHANGELOG.md file generation with `--file=false`
- Run `nx release p -d` and note that the packages are not naively published in alphabetical order, but instead take the dependency graph into account. This means that pkg-b is published first because it is a dependency of pkg-a. This ensures that if the publishing process were to encounter issues part way through, such as network outage or registry issues, then you are far less likely to end up with an overall inconsistent state.
- Additionally, you can see that if you run `nx release p` again, it will happily skip the projects which it has already published to a particular registry using a particular version and dist-tag (such as "latest") combination. This means that if you do encounter network or registry issues, you can simply re-run the command and it will effectively pick up where it left off.

So we can that `nx release` is capable of achieving a lot on package based repos without any configuration, even if Nx is not being used to orchestrate the workspace. But what if it is? What if we are leveraging the full power of Nx in an integrated monorepo set up and we want to really maximize our `nx release` usage?

## `nx release` in action - configuring an Nx integrated monorepo

Let's first start by outlining how to configure `nx release`. As with most core concepts in Nx, it has a relevant entry in teh `nx.json` file:

```jsonc
{
  // ...more nx config...
  "release": {}
}
```

The most powerful concept within release config is release groups. Release groups allow you to configure arbitrary groups of projects within your workspace which should be versioned and published together.

```jsonc
{
  // ...more nx config...
  "release": {
    "groups": {
      "my-group": {
        "projects": ["my-lib-1", "my-lib-2"]
      }
    }
  }
}
```

The group name is arbitrary and totally up to you. A specific group can then be filtered to using the `--groups` or `-g` flag on `nx release version` or `nx release publish`.

The "projects" property takes in any valid project specifier that you may be familiar with from the run/run-many commands,
such as a project name, a glob, or a directory. Negations are also possible using `!`, allowing you to group all matching projects except one, for example.

We will continue to build out the capabilities you can configure on a release group, but for now the main focus is on configuring the version generator that runs when you invoke `nx release version`.

Let's use a real example from the Nx repo itself to illustrate:

```jsonc
{
  // ...more nx config...
  "release": {
    "groups": {
      "npm": {
        "projects": [
          "packages/*",
          "packages/nx/native-packages/*",
          "packages-legacy/*"
        ],
        "version": {
          "generatorOptions": {
            "packageRoot": "build/packages/{projectName}",
            "currentVersionResolver": "registry"
          }
        }
      }
    }
  }
```

Here we are targeting a specific subset of the projects within the Nx workspace, and adjusting the version generator options to suit our needs.

The `currentVersionResolver` option is used to tell the version generator how to determine the current version of each project before attempting to derive an updated version. In this case, we are using the "registry" resolver which will query the npm registry for the current version of each project, instead of the default approach of "disk", which reads it from the package.json files themselves as we have seen so far.

The `packageRoot` option is used to tell the version generator where to find the package.json file for each project. You can see it supports interpolated values such as `{projectName}` which will be replaced with the name of the project being processed.

The other thing that might have stood out here is that we are versioning files that have been generated into a build directory, we are not directly versioning our source files which are tracked by git. This makes a lot sense when you think about the fact that in an integrated Nx workspace we are usually generating our final package.json via some kind of build executor.

It also allows you to keep your source files clean and free of versioning related noise, and it means that you can version and publish your projects without having to commit your changes to git first. Additionally, in the Nx repo allows us to use `file:` or `workspace:` specifiers for local dependencies within the workspace, and have those references overwritten with the correct version when we run `nx release version`.

When it comes to publishing, the implementation details actually call a standard target which gets created for your projects behind the scenes. This target is called "nx-release-publish", and so if we want to configure it, we can do so by overriding the target defaults.

```jsonc
{
  // ...more nx config...
  "targetDefaults": {
    "nx-release-publish": {
      "options": {
        "packageRoot": "build/packages/{projectName}"
      }
    }
  }
}
```

Again, here we are pointing the command at the build directory instead of the source directory, and we are using the same interpolated value for the packageRoot option.

This configuration structure is subject to change as we continue to build out the capabilities of `nx release`, but we are excited to share this early milestone with you now, and we will provide automated migrations for changes where possible.
