.PHONY: build watch test

build:
	npm run compile

watch:
	npm run watch

test: build
	cursor --extensionDevelopmentPath=$(PWD)
