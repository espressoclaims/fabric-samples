#!/bin/bash

docker rm -f $(docker ps -aq)
docker rmi $(docker images -a -q)
docker network prune
