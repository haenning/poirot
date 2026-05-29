.PHONY: build watch test test-manual

build:
	npm run compile

watch:
	npm run watch

test:
	npm test

test-manual: build
	cursor --extensionDevelopmentPath=$(PWD)
