mkdir -p /tmp/mongodb && \
    cd /tmp/mongodb && \
    wget -qOmongodb.tgz https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2004-5.0.2.tgz && \
    sudo cp bin/* /usr/local/bin/ && \
    rm -rf /tmp/mongodb && 
    cd /workspace && rm -rf /tmp/mongodb && \    
    sudo mkdir -p /workspace/db && \
    sudo chown gitpod:gitpod -R /workspace/db
    mongod --dbpath /workspace/db
