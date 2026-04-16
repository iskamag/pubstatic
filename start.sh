#!/bin/sh

cd $(dirname $0)
sudo -u pubstatic npm start > /var/log/pubstatic.log 2>/var/log/pubstatic.err
