require('dotenv').config();
const express = require('express');
(async () => {
  const app = express();
  app.use(express.json());
  app.disable('x-powered-by');

  const endpoint = (url = '/', options = {}) => {
    if (!options.headers) options.headers = {};
    options.headers['X-API-Key'] = process.env.PORTAINER_API_KEY;
    return fetch(`${process.env.PORTAINER_BASE_URL}/api${url}`, options);
  }

  let stacks = await endpoint('/stacks').then(response => response.json());
  setInterval(() => endpoint('/stacks').then(response => response.json()).then((d) => (stack = d)), 15_000);

  app.get('/', (req, res) => {
    if (process.env.NODE_ENV !== 'production') res.json(stacks.map(stack => {
      delete stack.Env;
      return stack;
    }));
    else res.send('Hello World! There is nothing to see here.');
  });

  async function updateStack(stackId) {
    const stack = stacks.find(stack => stack.Id === stackId || String(stack.Id) === stackId);
    if (!stack) return {error: 'Stack not found'};

    const stopped = await endpoint(`/stacks/${stack.Id}/stop?endpointId=${stack.EndpointId}`, { method: 'POST' }).then(response => response.json());
    const images = await endpoint(`/endpoints/${stack.EndpointId}/docker/images/json?all=0`).then(response => response.json());
    const imageHash = images.filter(x=>x.Labels).find(img => img.Labels['com.docker.compose.project'] == stack.Name)?.Id;
    if (imageHash) await endpoint(`/endpoints/${stack.EndpointId}/docker/images/${imageHash}?force=false`, { method: 'DELETE' }).then(response => response.json());
    const redeployed = await endpoint(`/stacks/${stack.Id}/git/redeploy?endpointId=${stack.EndpointId}`, {
      method: 'PUT',
      body: JSON.stringify({
        env: stack.Env,
        prune: false,
        RepositoryReferenceName: stack.GitConfig.ReferenceName,
        RepositoryAuthentication: !!stack.GitConfig.Authentication,
        RepositoryGitCredentialID: stack.GitConfig.Authentication?.GitCredentialID,
        RepositoryUsername: stack.GitConfig.Authentication?.Username,
        RepositoryPassword: stack.GitConfig.Authentication?.Password,
        PullImage: true
      })
    }).then(response => response.json());

    return { error: null, redeployed };
  }

  app.post('/webhook', async (req, res) => {
    if (req.headers['content-type'] !== 'application/json') return res.status(415).send('Unsupported Media Type');
    const stack = stacks.find(stack => stack.GitConfig.URL === req.body.repository.url || stack.GitConfig.URL === req.body.repository.clone_url);
    if (!stack) return res.status(404).send('No stack found for this repository');
    const githubEvent = req.headers['x-github-event'];
    if (githubEvent == 'ping') return res.status(200).send('Pong!');
    if (githubEvent !== 'push') return res.status(400).send('Unsupported Event Type');
    res.status(202).send('Accepted! Updating stack with latest commits...');
    console.log(`[${new Date().toISOString()}] Updating stack with id: ${stack.Id}`);
    const stackFunction = await updateStack(stack.Id);
    if (stackFunction.error) return console.error(`[${new Date().toISOString()}] Error while updating stack with id ${stack.id}. Error: ${stackFunction.error}`);
    else console.log(`[${new Date().toISOString()}] Updated stack with id: ${stack.Id}`);
  });

  app.get('/update/:id', async (req, res) => {
    if (process.env.NODE_ENV == 'production') return res.status(403).json({ error: 'Forbidden' });
    const { error, redeployed } = await updateStack(req.params.id);
    if (error) return res.status(404).json({ error });
    res.json({ message: 'Stack updated', hash: redeployed.GitConfig.ConfigHash });
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
})();