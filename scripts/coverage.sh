#!/bin/bash

# Accept all test files as arguments
TEST_FILES="$@"

# Convert test file paths to source file paths
SOURCE_FILES=""
for TEST_FILE in $TEST_FILES; do
  SOURCE_FILE=$(echo "$TEST_FILE" | sed 's|/__test__|/|' | sed 's|\.test\.ts|.ts|')
  
  # Check if the resulting file doesn't exist, try index.ts instead
  if [ ! -f "$SOURCE_FILE" ]; then
    DIR=$(dirname "$SOURCE_FILE")
    BASENAME=$(basename "$SOURCE_FILE" .ts)
    PARENT_DIR_NAME=$(basename "$DIR")
    
    # If the file name matches the parent directory name, use index.ts
    if [ "$BASENAME" = "$PARENT_DIR_NAME" ]; then
      SOURCE_FILE="$DIR/index.ts"
    fi
  fi
  
  if [ -f "$SOURCE_FILE" ]; then
    SOURCE_FILES="$SOURCE_FILES --include=$SOURCE_FILE"
  fi
done

rm -rf coverage
NODE_V8_COVERAGE=coverage node --test-concurrency=1 --experimental-strip-types --test $TEST_FILES > /dev/null 2>&1
TEST_EXIT_CODE=$?

if [ $TEST_EXIT_CODE -ne 0 ]; then
  echo "Tests failed with exit code $TEST_EXIT_CODE. Running tests again to show errors:"
NODE_V8_COVERAGE=coverage node --test-concurrency=1 --experimental-strip-types --test $TEST_FILES > /dev/null 2>&1
  node --test-concurrency=1 --experimental-strip-types --test $TEST_FILES
  exit $TEST_EXIT_CODE
fi

npx c8 report --temp-directory=coverage --reporter=text --exclude='**/__test__/**' $SOURCE_FILES --all=false
