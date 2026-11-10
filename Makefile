# Thin wrapper; the workspace lives in code/ (the repository root keeps only the planning documents).
.PHONY: install dev test lint typecheck reset-test check-migrations verify
install:          ; cd code && npm install
dev:              ; cd code && npm run dev
test:             ; cd code && npm test
lint:             ; cd code && npm run lint
typecheck:        ; cd code && npm run typecheck
reset-test:       ; cd code && npm run db:reset-test
check-migrations: ; cd code && npm run check:migrations
verify:           ; cd code && npm run verify
