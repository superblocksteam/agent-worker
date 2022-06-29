.PHONY: install-dev
install-dev:
	npm install

.PHONY: build
build: install-dev
	npm run build

.PHONY: install-prod
install-prod: install-dev build
	rm -rf node_modules
	npm install --production

.PHONY: docker
docker: install-dev build install-prod
	docker build .

.PHONY: docker-up
docker-up: install-dev build install-prod
	docker compose -f docker-compose.yaml up

.PHONY: test
test: install-dev
	npm run test
