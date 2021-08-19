#!/bin/sh
set -xe
#Build and push image

#Login to registry
docker login -u gitlab-ci-token -p $CI_JOB_TOKEN $CI_REGISTRY
docker build -t ${CONTAINER_RELEASE_IMAGE} -f Dockerfile .
docker push ${CONTAINER_RELEASE_IMAGE}
