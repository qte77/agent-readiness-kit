.PHONY: install test typecheck build scan site_build preview \
        worker_install worker_test worker_typecheck worker_dev help
.DEFAULT_GOAL := help


# MARK: SETUP


install:  ## Install dependencies
	npm install


# MARK: QUALITY


test:  ## Run unit tests
	npx vitest run

typecheck:  ## Static type check with tsc
	npx tsc --noEmit


# MARK: BUILD


build:  ## Compile TypeScript to dist/
	npm run build

scan:  ## Run a real scan over config/properties.ts's PROPERTIES (needs GITHUB_TOKEN for the issue step)
	npm run scan

site_build:  ## Build the GitHub Pages dashboard into site-dist/
	npm run site:build


# MARK: PREVIEW


preview: build site_build  ## Build and serve the dashboard locally
	npx serve site-dist


# MARK: WORKER


worker_install:  ## Install worker/'s own dependencies
	cd worker && npm install

worker_test:  ## Run worker/'s tests
	cd worker && npm test

worker_typecheck:  ## Static type check worker/ with tsc
	cd worker && npm run typecheck

worker_dev:  ## Run the worker locally via wrangler dev
	cd worker && npm run dev


# MARK: HELP


help:  ## Show available recipes grouped by section
	@echo "Usage: make [recipe]"
	@echo ""
	@awk '/^# MARK:/ { \
		section = substr($$0, index($$0, ":")+2); \
		printf "\n\033[1m%s\033[0m\n", section \
	} \
	/^[a-zA-Z0-9_-]+:.*?##/ { \
		helpMessage = match($$0, /## (.*)/); \
		if (helpMessage) { \
			recipe = $$1; \
			sub(/:/, "", recipe); \
			printf "  \033[36m%-16s\033[0m %s\n", recipe, substr($$0, RSTART + 3, RLENGTH) \
		} \
	}' $(MAKEFILE_LIST)
