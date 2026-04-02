#!/bin/sh

current_branch=$(git symbolic-ref --short HEAD)

if [ "$current_branch" = "develop" ]; then
  echo "You cannot commit on develop branch"
  exit 1
fi
