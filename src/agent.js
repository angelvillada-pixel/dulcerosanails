export async function sendToAgent(message) {
  const res = await fetch("https://TU-BACKEND.onrender.com/admin/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer supersecreto"
    },
    body: JSON.stringify({ message })
  });

  return await res.json();
}
