.PHONY: build watch test test-manual pr pr-open

build:
	npm run compile

watch:
	npm run watch

test:
	npm test

test-manual: build
	cursor --extensionDevelopmentPath=$(PWD)

pr:
	git push -u origin HEAD
	@BRANCH=$$(git branch --show-current); \
	if [ -z "$$BRANCH" ]; then echo "Not on a named branch."; exit 1; fi; \
	if [ "$$BRANCH" = "main" ]; then echo "Cannot open a PR from main to main."; exit 1; fi; \
	EXISTING=$$(gh pr list --head "$$BRANCH" --base main --json url,isDraft --jq '.[0]' 2>/dev/null); \
	if [ -n "$$EXISTING" ] && [ "$$EXISTING" != "null" ]; then \
		URL=$$(echo "$$EXISTING" | jq -r '.url'); \
		IS_DRAFT=$$(echo "$$EXISTING" | jq -r '.isDraft'); \
		if [ "$$IS_DRAFT" = "true" ]; then \
			echo "Draft PR already exists: $$URL"; \
		else \
			echo "Open PR already exists: $$URL"; \
		fi; \
	else \
		echo "Creating draft PR: $$BRANCH -> main"; \
		gh pr create --base main --head "$$BRANCH" \
			--title "$$BRANCH -> main" \
			--body "Draft PR from $$BRANCH to main" \
			--assignee haenning \
			--draft; \
	fi

pr-open:
	git push -u origin HEAD
	@BRANCH=$$(git branch --show-current); \
	if [ -z "$$BRANCH" ]; then echo "Not on a named branch."; exit 1; fi; \
	if [ "$$BRANCH" = "main" ]; then echo "Cannot open a PR from main to main."; exit 1; fi; \
	EXISTING=$$(gh pr list --head "$$BRANCH" --base main --json number,url,isDraft --jq '.[0]' 2>/dev/null); \
	if [ -n "$$EXISTING" ] && [ "$$EXISTING" != "null" ]; then \
		URL=$$(echo "$$EXISTING" | jq -r '.url'); \
		IS_DRAFT=$$(echo "$$EXISTING" | jq -r '.isDraft'); \
		if [ "$$IS_DRAFT" = "true" ]; then \
			NUMBER=$$(echo "$$EXISTING" | jq -r '.number'); \
			echo "Converting draft PR #$$NUMBER to ready for review..."; \
			gh pr ready "$$NUMBER"; \
			echo "PR is now open: $$URL"; \
		else \
			echo "PR is already open: $$URL"; \
		fi; \
	else \
		echo "No existing PR — creating ready PR: $$BRANCH -> main"; \
		gh pr create --base main --head "$$BRANCH" \
			--title "$$BRANCH -> main" \
			--body "PR from $$BRANCH to main" \
			--assignee haenning; \
	fi
