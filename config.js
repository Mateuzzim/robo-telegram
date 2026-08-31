const CONFIG = {
  wheel: {
    wsUrl: 'wss://api.inout.games/io/?gameMode=wheel&operatorId=ee2013ed-e1f0-4d6e-97d2-f36619e2eb52&Authorization=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJlMDgxMmNkYS04NDA1LTQ3MDktOTYyMC04NTlmZmY5NmM1ZGQiLCJuaWNrbmFtZSI6Ik9yYW5nZSBTdXBlcmlvciBTbHVnIiwiYmFsYW5jZSI6IjEwMDAwMDAiLCJjdXJyZW5jeSI6IlVTRCIsIm9wZXJhdG9yIjoiZWUyMDEzZWQtZTFmMC00ZDZlLTk3ZDItZjM2NjE5ZTJlYjUyIiwib3BlcmF0b3JJZCI6ImVlMjAxM2VkLWUxZjAtNGQ2ZS05N2QyLWYzNjYxOWUyZWI1MiIsImdhbWVNb2RlIjoid2hlZWwiLCJtZXRhIjpudWxsLCJnYW1lQXZhdGFyIjpudWxsLCJzZXNzaW9uVG9rZW4iOiJ6ZnlkcHgiLCJpYXQiOjE3ODc4NzgzMDksImV4cCI6MTc4Nzk2NDcwOX0.1aZ_3c32rMzADfFRDpv_C_cOZaiLXE053BoUuVF0nn0&EIO=4&transport=websocket',
    label: 'wheel'
  },
  double: {
    wsUrl: 'wss://api.inout.games/io/?operatorId=ee2013ed-e1f0-4d6e-97d2-f36619e2eb52&Authorization=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJlMDgxMmNkYS04NDA1LTQ3MDktOTYyMC04NTlmZmY5NmM1ZGQiLCJuaWNrbmFtZSI6Ik9yYW5nZSBTdXBlcmlvciBTbHVnIiwiYmFsYW5jZSI6IjEwMDAwMDAiLCJjdXJyZW5jeSI6IlVTRCIsIm9wZXJhdG9yIjoiZWUyMDEzZWQtZTFmMC00ZDZlLTk3ZDItZjM2NjE5ZTJlYjUyIiwib3BlcmF0b3JJZCI6ImVlMjAxM2VkLWUxZjAtNGQ2ZS05N2QyLWYzNjYxOWUyZWI1MiIsImdhbWVNb2RlIjoibmV3LWRvdWJsZSIsIm1ldGEiOm51bGwsImdhbWVBdmF0YXIiOm51bGwsInNlc3Npb25Ub2tlbiI6InpmeWRweCIsImlhdCI6MTc4Nzg3ODM0MSwiZXhwIjoxNzg3OTY0NzQxfQ.Sj386RmGuuYUj73XYUdz3sSepTDHIrVP84kmDTvB3qM&gameMode=new-double&EIO=4&transport=websocket',
    label: 'double'
  },
  robotDefaults: {
    resultsToAnalyze: 40,
    minimumConfidence: 80,
    confirmations: 2,
    intervalMin: 60,
    galeMax: 2
  }
};

try {
  const savedWsConfig = JSON.parse(localStorage.getItem('ws-config-v1') || '{}');
  if (savedWsConfig.wheelWsUrl) CONFIG.wheel.wsUrl = savedWsConfig.wheelWsUrl;
  if (savedWsConfig.doubleWsUrl) CONFIG.double.wsUrl = savedWsConfig.doubleWsUrl;
} catch {}
