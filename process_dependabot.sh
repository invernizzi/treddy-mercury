#!/bin/bash
set -e

git checkout main
git pull origin main --rebase

branches=$(git branch -r | grep dependabot)

for branch in $branches; do
    echo "==============================================="
    echo "Testing branch: $branch"
    
    if ! git merge "$branch" --no-edit; then
        echo "Handling merge conflict..."
        # If conflict is only in package-lock.json (which is 99% of dependabot conflicts)
        if git diff --name-only --diff-filter=U | grep -q "package-lock.json" && [ $(git diff --name-only --diff-filter=U | wc -l) -eq 1 ]; then
            echo "Conflict is just package-lock.json. Rebuilding lockfile..."
            git checkout --theirs pwa/package-lock.json
            cd pwa
            npm install --registry=https://registry.npmjs.org/
            git add package-lock.json
            cd ..
            git commit --no-edit
        else
            echo "Non-trivial merge conflict for $branch. Aborting merge."
            git merge --abort
            continue
        fi
    fi

    echo "Running build..."
    cd pwa
    if ! npm run build; then
        echo "Build failed for $branch. Reverting."
        git checkout -- .
        cd ..
        git reset --hard HEAD^
        continue
    fi

    echo "Running tests..."
    if ! npx vitest run tests/ble.spec.ts; then
        echo "Tests failed for $branch. Reverting."
        git checkout -- .
        cd ..
        git reset --hard HEAD^
        continue
    fi
    cd ..

    echo "✅ Successfully merged and validated $branch!"
    # Push immediately so we save progress
    git push origin main
done

echo "All done!"
